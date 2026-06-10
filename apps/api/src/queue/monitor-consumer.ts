import { nanoid } from "nanoid";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, inArray } from "drizzle-orm";
import { sites, pages, crawlRuns } from "@profound-takehome/db";
import type { Env, MonitorMessage } from "../bindings";
import { politeFetch } from "../crawler/fetcher";
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
    })
    .from(pages)
    .where(and(eq(pages.siteId, siteId), eq(pages.status, "active")));

  const sitemap = await fetchSitemap(site.domain);
  const conditional: { url: string; outcome: ConditionalOutcome }[] = [];
  let sitemapDiff;

  if (sitemap) {
    // Layer 1: structural diff is nearly free.
    sitemapDiff = diffSitemap(activePages, sitemap);
    // Layer 2: verify lastmod candidates with conditional GETs (cheap 304s).
    const validators = new Map(activePages.map((p) => [p.url, p]));
    for (const url of byDepth(sitemapDiff.lastmodChanged).slice(0, MAX_CONDITIONAL_GETS)) {
      const stored = validators.get(url);
      if (!stored) continue;
      conditional.push({ url, outcome: await conditionalCheck(url, stored) });
    }
  } else {
    // No sitemap: sample known pages, shallowest first (homepage and section
    // roots change most and matter most to llms.txt structure).
    for (const page of byDepth(activePages.map((p) => p.url)).slice(0, MAX_CONDITIONAL_GETS)) {
      const stored = activePages.find((p) => p.url === page);
      if (!stored) continue;
      conditional.push({ url: page, outcome: await conditionalCheck(page, stored) });
    }
  }

  const changes = buildChangeSet({ sitemap: sitemapDiff, conditional });
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
      startedAt: now,
    });
    // One discover message; the crawl pipeline re-crawls the site and
    // regenerates the file. Page upserts are idempotent so overlap with a
    // manual run is safe.
    await env.CRAWL_QUEUE.send({ type: "discover", runId, siteId, url: site.domain });
  }

  const interval = nextInterval(site.checkIntervalS, changesFound);
  await db
    .update(sites)
    .set({
      checkIntervalS: interval,
      nextCheckAt: now + interval,
      changeStreak: nextStreak(site.changeStreak, changesFound),
    })
    .where(eq(sites.id, siteId));
}

async function conditionalCheck(
  url: string,
  stored: { etag: string | null; lastModified: string | null },
): Promise<ConditionalOutcome> {
  try {
    const res = await politeFetch(url, {
      etag: stored.etag ?? undefined,
      lastModified: stored.lastModified ?? undefined,
    });
    // Drain the body so the connection can be reused; we only need headers.
    // TODO(integration): use crawler/extract contentHash on this body for a
    // definitive compare once the crawl stream lands.
    if (res.body) await res.body.cancel();
    return classifyConditionalGet(res, stored);
  } catch {
    return "error";
  }
}

async function fetchSitemap(origin: string): Promise<SitemapEntry[] | null> {
  try {
    const res = await politeFetch(`${origin}/sitemap.xml`);
    if (res.status !== 200 || !res.body) return null;
    const xml = await new Response(res.body).text();
    // A sitemap index would need recursive fetching — out of scope for a
    // monitor check; fall back to conditional GETs instead.
    if (/<sitemapindex[\s>]/i.test(xml)) return null;
    const entries = parseSitemapXml(xml);
    return entries.length > 0 ? entries : null;
  } catch {
    return null;
  }
}

/**
 * Minimal <loc>/<lastmod> extraction. Intentionally local to this consumer:
 * crawler/sitemap.ts belongs to the crawl stream and we must not depend on
 * its internals (see AGENTS stream boundaries).
 */
export function parseSitemapXml(xml: string): SitemapEntry[] {
  const entries: SitemapEntry[] = [];
  for (const block of xml.match(/<url[\s>][\s\S]*?<\/url>/gi) ?? []) {
    const loc = /<loc>\s*([\s\S]*?)\s*<\/loc>/i.exec(block)?.[1];
    if (!loc) continue;
    const lastmod = /<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/i.exec(block)?.[1] ?? null;
    entries.push({ url: decodeXmlEntities(loc), lastmod });
  }
  return entries;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&"); // last, so &amp;lt; doesn't double-decode
}

/** Sort URLs by path depth, shallowest first; stable on ties via string order. */
export function byDepth(urls: string[]): string[] {
  const depth = (u: string): number => {
    try {
      return new URL(u).pathname.split("/").filter(Boolean).length;
    } catch {
      return Number.MAX_SAFE_INTEGER;
    }
  };
  return [...urls].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
}
