import { nanoid } from "nanoid";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, inArray } from "drizzle-orm";
import { sites, pages, crawlRuns } from "@profound-takehome/db";
import { summarizeChanges } from "@profound-takehome/shared";
import type { Env, MonitorMessage } from "../bindings";
import { isHtml, politeFetch } from "../crawler/fetcher";
import { extract } from "../crawler/extract";
import { fetchRobots } from "../crawler/robots";
import { discoverSitemapEntries } from "../crawler/sitemap";
import { urlPathDepth } from "../lib/url";
import {
  buildChangeSet,
  classifyConditionalGet,
  diffSitemap,
  isRegenerationWorthy,
  type ConditionalOutcome,
  type SitemapEntry,
} from "../monitor/detect";
import { nextInterval, nextStreak } from "../monitor/schedule";

/** Hard cap on outbound requests per check (sitemap fetch excluded). */
const MAX_CONDITIONAL_GETS = 30;
const MAX_MONITOR_SITEMAP_URLS = 1_000;

/**
 * monitor-queue consumer. For each due site:
 *   1. Sitemap diff (cheap signal) — falls back to conditional GETs over
 *      known pages (shallowest first) when no sitemap is available.
 *   2. Conditional GETs (ETag/Last-Modified) for candidates.
 *   3. Content-hash compare belongs to the crawl pipeline; here we only act
 *      on HTTP-level signals and let the re-crawl resolve ambiguity.
 * If a structural or metadata change is detected, kick off a monitor-trigger
 * crawl run (the crawl pipeline re-crawls + regenerates; upserts are
 * idempotent) and mark removed pages in D1.
 *
 * Adaptive cadence: next_check_at always advances based on whether changes
 * were found, even on a quiet check.
 */
export async function handleMonitorBatch(
  batch: MessageBatch<MonitorMessage>,
  env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  for (const msg of batch.messages) {
    try {
      await checkSite(env, msg.body.siteId);
      msg.ack();
    } catch (err) {
      console.error("monitor handler failed", msg.body, err);
      msg.retry();
    }
  }
}

async function checkSite(env: Env, siteId: string): Promise<void> {
  const db = drizzle(env.DB);
  const site = await db.select().from(sites).where(eq(sites.id, siteId)).get();
  if (!site || !site.monitoring) return; // unregistered or paused — drop quietly

  const activePages = await db
    .select({
      url: pages.url,
      etag: pages.etag,
      lastModified: pages.lastModified,
      sitemapLastmod: pages.sitemapLastmod,
      contentHash: pages.contentHash,
    })
    .from(pages)
    .where(and(eq(pages.siteId, siteId), eq(pages.status, "active")));

  const robots = await fetchRobots(site.domain);
  const sitemap = await fetchSitemap(site.domain, robots.sitemaps);
  const conditional: { url: string; outcome: ConditionalOutcome }[] = [];
  const hashes: { url: string; storedHash: string | null; currentHash: string | null }[] = [];
  let sitemapDiff;
  const validators = new Map(activePages.map((p) => [p.url, p]));

  const record = (url: string, result: CheckResult): void => {
    const resolved = resolveCheck(url, result);
    conditional.push(resolved.conditional);
    if (resolved.hash) hashes.push(resolved.hash);
  };

  if (sitemap) {
    // Layer 1: structural diff is nearly free.
    sitemapDiff = diffSitemap(activePages, sitemap);
    // Layer 2: verify lastmod candidates with conditional GETs (cheap 304s).
    for (const url of byDepth(sitemapDiff.lastmodChanged).slice(0, MAX_CONDITIONAL_GETS)) {
      const stored = validators.get(url);
      if (!stored) continue;
      record(url, await conditionalCheck(url, stored));
    }
  } else {
    // No sitemap: sample known pages, shallowest first (homepage and section
    // roots change most and matter most to llms.txt structure).
    for (const page of byDepth(activePages.map((p) => p.url)).slice(0, MAX_CONDITIONAL_GETS)) {
      const stored = validators.get(page);
      if (!stored) continue;
      record(page, await conditionalCheck(page, stored));
    }
  }

  const changes = buildChangeSet({ sitemap: sitemapDiff, conditional, hashes });
  const changesFound = isRegenerationWorthy(changes);
  const now = Math.floor(Date.now() / 1000);

  if (changesFound) {
    if (changes.removed.length > 0) {
      await db
        .update(pages)
        .set({ status: "removed" })
        .where(and(eq(pages.siteId, siteId), inArray(pages.url, changes.removed)));
    }

    const runId = nanoid(12);
    await db.insert(crawlRuns).values({
      id: runId,
      siteId,
      trigger: "monitor",
      status: "queued",
      pagesChanged: changes.added.length + changes.removed.length + changes.modified.length,
      changeSummary: summarizeChanges(changes),
      startedAt: now,
    });
    // One discover message; the crawl pipeline re-crawls the site and
    // regenerates the file. Page upserts are idempotent so overlap with a
    // manual run is safe.
    await env.CRAWL_QUEUE.send({ type: "discover", runId, siteId, url: site.domain });
  }

  // Pass the streak BEFORE this check so a sustained trend compounds cadence.
  const interval = nextInterval(site.checkIntervalS, changesFound, site.changeStreak);
  await db
    .update(sites)
    .set({
      checkIntervalS: interval,
      nextCheckAt: now + interval,
      changeStreak: nextStreak(site.changeStreak, changesFound),
    })
    .where(eq(sites.id, siteId));
}

/**
 * Outcome of one conditional GET. When `currentHash` is present we computed a
 * definitive content hash from the fetched body — the caller treats that as
 * authoritative over the conditional `outcome` for "modified" verdicts.
 */
type CheckResult = {
  outcome: ConditionalOutcome;
  storedHash: string | null;
  /** undefined = no body-level verdict; null = stored had no hash to compare. */
  currentHash?: string | null;
};

/**
 * Fold one check into the detection inputs, avoiding double-counting. A
 * definitive content-hash verdict (currentHash present) is authoritative, so
 * we downgrade a conditional "modified" to "unchanged" for that URL — the
 * hash, not a validator-less guess, decides whether it lands in `modified`.
 * "removed"/"error"/validator-confirmed "unchanged" outcomes are kept.
 */
export function resolveCheck(
  url: string,
  result: CheckResult,
): {
  conditional: { url: string; outcome: ConditionalOutcome };
  hash?: { url: string; storedHash: string | null; currentHash: string | null };
} {
  if (result.currentHash !== undefined) {
    return {
      conditional: { url, outcome: result.outcome === "modified" ? "unchanged" : result.outcome },
      hash: { url, storedHash: result.storedHash, currentHash: result.currentHash },
    };
  }
  return { conditional: { url, outcome: result.outcome } };
}

async function conditionalCheck(
  url: string,
  stored: { etag: string | null; lastModified: string | null; contentHash: string | null },
): Promise<CheckResult> {
  try {
    const res = await politeFetch(url, {
      etag: stored.etag ?? undefined,
      lastModified: stored.lastModified ?? undefined,
    });
    const outcome = classifyConditionalGet(res, stored);

    // On a 200 with an HTML body, compute a content hash for a definitive
    // body-level compare — this resolves validator-less false positives that
    // classifyConditionalGet can only guess at.
    if (res.status === 200 && res.body && isHtml(res.contentType)) {
      const { contentHash } = await extract(res.body);
      return { outcome, storedHash: stored.contentHash, currentHash: contentHash };
    }

    // No body to hash (304/3xx/error or non-HTML): drain so the connection can
    // be reused; the conditional outcome stands on its own.
    if (res.body) await res.body.cancel();
    return { outcome, storedHash: stored.contentHash };
  } catch {
    return { outcome: "error", storedHash: stored.contentHash };
  }
}

async function fetchSitemap(origin: string, declared: string[]): Promise<SitemapEntry[] | null> {
  try {
    const discovery = await discoverSitemapEntries(origin, declared, {
      maxUrls: MAX_MONITOR_SITEMAP_URLS,
    });
    const entries = discovery.entries.map((entry) => ({
      url: entry.url,
      lastmod: entry.lastmod ?? null,
    }));
    return entries.length > 0 ? entries : null;
  } catch {
    return null;
  }
}

/** Sort URLs by path depth, shallowest first; stable on ties via string order. */
export function byDepth(urls: string[]): string[] {
  return [...urls].sort((a, b) => urlPathDepth(a) - urlPathDepth(b) || a.localeCompare(b));
}
