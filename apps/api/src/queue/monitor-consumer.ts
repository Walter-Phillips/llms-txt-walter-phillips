import { nanoid } from "nanoid";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, inArray } from "drizzle-orm";
import { sites, pages, crawlRuns } from "@profound-takehome/db";
import { summarizeChanges } from "@profound-takehome/shared";
import type { Environment, MonitorMessage } from "../bindings";
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
import { logError, logInfo } from "../observability/logger";
import { captureHandledException } from "../observability/sentry";

/** Hard cap on outbound requests per check (sitemap fetch excluded). */
const MAX_CONDITIONAL_GETS = 30;
const MAX_MONITOR_SITEMAP_URLS = 1_000;
type Database = ReturnType<typeof drizzle>;

interface ActivePage {
  url: string;
  etag: string | null;
  lastModified: string | null;
  sitemapLastmod: string | null;
  contentHash: string | null;
}

interface MonitorSignals {
  sitemap: ReturnType<typeof diffSitemap> | undefined;
  conditional: { url: string; outcome: ConditionalOutcome }[];
  hashes: { url: string; storedHash: string | null; currentHash: string | null }[];
}

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
 * @param batch Queue batch delivered by Cloudflare.
 * @param env Worker bindings used by monitor checks.
 * @param _ctx Worker execution context, currently unused.
 */
export async function handleMonitorBatch(
  batch: MessageBatch<MonitorMessage>,
  env: Environment,
  _ctx: ExecutionContext,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await checkSite(env, message.body.siteId);
      message.ack();
    } catch (err) {
      captureHandledException(err, {
        workflow: "monitor",
        step: "queue_message",
        outcome: "retry",
        queue: batch.queue,
        messageType: message.body.type,
        siteId: message.body.siteId,
      });
      logError("monitor_message_failed", {
        workflow: "monitor",
        step: "queue_message",
        outcome: "retry",
        queue: batch.queue,
        messageType: message.body.type,
        siteId: message.body.siteId,
        error: err instanceof Error ? err : new Error(String(err)),
      });
      message.retry();
    }
  }
}

async function loadActivePages(db: Database, siteId: string): Promise<ActivePage[]> {
  return await db
    .select({
      url: pages.url,
      etag: pages.etag,
      lastModified: pages.lastModified,
      sitemapLastmod: pages.sitemapLastmod,
      contentHash: pages.contentHash,
    })
    .from(pages)
    .where(and(eq(pages.siteId, siteId), eq(pages.status, "active")));
}

async function collectMonitorSignals(
  activePages: ActivePage[],
  sitemap: SitemapEntry[] | null,
): Promise<MonitorSignals> {
  const conditional: { url: string; outcome: ConditionalOutcome }[] = [];
  const hashes: { url: string; storedHash: string | null; currentHash: string | null }[] = [];
  let sitemapDiff: ReturnType<typeof diffSitemap> | undefined;
  const validators = new Map(activePages.map((page) => [page.url, page]));

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
    for (const page of byDepth(activePages.map((activePage) => activePage.url)).slice(
      0,
      MAX_CONDITIONAL_GETS,
    )) {
      const stored = validators.get(page);
      if (!stored) continue;
      record(page, await conditionalCheck(page, stored));
    }
  }

  return { sitemap: sitemapDiff, conditional, hashes };
}

async function enqueueMonitorCrawl(input: {
  db: Database;
  env: Environment;
  siteId: string;
  domain: string;
  changes: ReturnType<typeof buildChangeSet>;
  now: number;
}): Promise<void> {
  if (input.changes.removed.length > 0) {
    await input.db
      .update(pages)
      .set({ status: "removed" })
      .where(and(eq(pages.siteId, input.siteId), inArray(pages.url, input.changes.removed)));
  }

  const runId = nanoid(12);
  await input.db.insert(crawlRuns).values({
    id: runId,
    siteId: input.siteId,
    trigger: "monitor",
    status: "queued",
    pagesChanged:
      input.changes.added.length + input.changes.removed.length + input.changes.modified.length,
    changeSummary: summarizeChanges(input.changes),
    startedAt: input.now,
  });
  await input.env.CRAWL_QUEUE.send({
    type: "discover",
    runId,
    siteId: input.siteId,
    url: input.domain,
  });
  logInfo("monitor_crawl_queued", {
    workflow: "monitor",
    step: "enqueue_crawl",
    outcome: "queued",
    siteId: input.siteId,
    runId,
    domain: input.domain,
    addedCount: input.changes.added.length,
    removedCount: input.changes.removed.length,
    modifiedCount: input.changes.modified.length,
  });
}

async function advanceMonitorCadence(input: {
  db: Database;
  siteId: string;
  checkIntervalS: number;
  changeStreak: number;
  changesFound: boolean;
  now: number;
}): Promise<void> {
  // Pass the streak BEFORE this check so a sustained trend compounds cadence.
  const interval = nextInterval(input.checkIntervalS, input.changesFound, input.changeStreak);
  await input.db
    .update(sites)
    .set({
      checkIntervalS: interval,
      nextCheckAt: input.now + interval,
      changeStreak: nextStreak(input.changeStreak, input.changesFound),
    })
    .where(eq(sites.id, input.siteId));
  logInfo("monitor_cadence_advanced", {
    workflow: "monitor",
    step: "cadence",
    outcome: "updated",
    siteId: input.siteId,
    changesFound: input.changesFound,
    previousIntervalS: input.checkIntervalS,
    nextIntervalS: interval,
  });
}

async function checkSite(env: Environment, siteId: string): Promise<void> {
  const db = drizzle(env.DB);
  const site = await db.select().from(sites).where(eq(sites.id, siteId)).get();
  if (!site?.monitoring) {
    logInfo("monitor_site_skipped", {
      workflow: "monitor",
      step: "check",
      outcome: "skipped",
      siteId,
      reason: site ? "paused" : "missing",
    });
    return;
  }

  const activePages = await loadActivePages(db, siteId);
  const robots = await fetchRobots(site.domain);
  const sitemap = await fetchSitemap(site.domain, robots.sitemaps);
  const signals = await collectMonitorSignals(activePages, sitemap);
  const changes = buildChangeSet(signals);
  const changesFound = isRegenerationWorthy(changes);
  const now = Math.floor(Date.now() / 1000);

  if (changesFound) {
    await enqueueMonitorCrawl({ db, env, siteId, domain: site.domain, changes, now });
  }
  logInfo("monitor_site_checked", {
    workflow: "monitor",
    step: "check",
    outcome: changesFound ? "changes_found" : "unchanged",
    siteId,
    domain: site.domain,
    activePageCount: activePages.length,
    sitemapEntryCount: sitemap?.length ?? 0,
    addedCount: changes.added.length,
    removedCount: changes.removed.length,
    modifiedCount: changes.modified.length,
    conditionalErrorCount: signals.conditional.filter((check) => check.outcome === "error").length,
  });
  await advanceMonitorCadence({
    db,
    siteId,
    checkIntervalS: site.checkIntervalS,
    changeStreak: site.changeStreak,
    changesFound,
    now,
  });
}

/**
 * Outcome of one conditional GET. When `currentHash` is present we computed a
 * definitive content hash from the fetched body — the caller treats that as
 * authoritative over the conditional `outcome` for "modified" verdicts.
 */
interface CheckResult {
  outcome: ConditionalOutcome;
  storedHash: string | null;
  /** undefined = no body-level verdict; null = stored had no hash to compare. */
  currentHash?: string | null;
}

/**
 * Fold one check into the detection inputs, avoiding double-counting. A
 * definitive content-hash verdict (currentHash present) is authoritative, so
 * we downgrade a conditional "modified" to "unchanged" for that URL — the
 * hash, not a validator-less guess, decides whether it lands in `modified`.
 * "removed"/"error"/validator-confirmed "unchanged" outcomes are kept.
 * @param url URL that was checked.
 * @param result Conditional GET and optional hash result.
 * @returns Detection inputs for this URL.
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

/**
 * Sort URLs by path depth, shallowest first; stable on ties via string order.
 * @param urls URLs to order for monitor checks.
 * @returns URLs ordered from shallowest path to deepest path.
 */
export function byDepth(urls: string[]): string[] {
  return [...urls].sort((a, b) => urlPathDepth(a) - urlPathDepth(b) || a.localeCompare(b));
}
