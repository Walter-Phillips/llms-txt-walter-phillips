import { and, eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { pages } from "@profound-takehome/db";
import { hashChanged, type ConditionalOutcome, type diffSitemap } from "../monitor/detect";
import { nextPageInterval, nextPageStreak } from "../monitor/schedule";
import { urlPathDepth } from "../lib/url";

type Database = ReturnType<typeof drizzle>;

export interface ActivePage {
  url: string;
  etag: string | null;
  lastModified: string | null;
  sitemapLastmod: string | null;
  contentHash: string | null;
  lastCheckedAt: number | null;
  lastChangedAt: number | null;
  pageCheckIntervalS: number;
  pageChangeStreak: number;
}

export interface MonitorCheckResult {
  outcome: ConditionalOutcome;
  storedHash: string | null;
  /** undefined = no body-level verdict; null = stored had no hash to compare. */
  currentHash?: string | null;
}

function checkChanged(result: MonitorCheckResult): boolean {
  if (result.currentHash !== undefined) return hashChanged(result.storedHash, result.currentHash);
  return result.outcome === "modified";
}

function pageDueAt(page: ActivePage): number {
  if (page.lastCheckedAt === null) return 0;
  return page.lastCheckedAt + page.pageCheckIntervalS;
}

function byPageStaleness(a: ActivePage, b: ActivePage): number {
  return (
    (a.lastCheckedAt ?? 0) - (b.lastCheckedAt ?? 0) ||
    urlPathDepth(a.url) - urlPathDepth(b.url) ||
    a.url.localeCompare(b.url)
  );
}

function stalePageUrls(pagesToCheck: ActivePage[], now: number): string[] {
  return pagesToCheck
    .filter((page) => pageDueAt(page) <= now)
    .sort(byPageStaleness)
    .map((page) => page.url);
}

function byDepth(urls: string[]): string[] {
  return [...urls].sort((a, b) => urlPathDepth(a) - urlPathDepth(b) || a.localeCompare(b));
}

/**
 * Choose a bounded set of pages to verify during one monitor check. Sitemap
 * lastmod candidates win first, then stale known pages fill any remaining
 * budget so inaccurate sitemaps do not fully hide page changes.
 *
 * @param activePages Active page rows with stored freshness metadata.
 * @param sitemapDiff Optional sitemap diff for sitemap-backed sites.
 * @param limit Maximum pages to conditionally fetch.
 * @param now Current epoch second.
 * @returns Ordered URL candidates for conditional checks.
 */
export function selectMonitorCandidates(
  activePages: ActivePage[],
  sitemapDiff: ReturnType<typeof diffSitemap> | undefined,
  limit: number,
  now: number,
): string[] {
  const selected = new Set<string>();
  const out: string[] = [];

  for (const url of byDepth(sitemapDiff?.lastmodChanged ?? [])) {
    if (out.length >= limit) return out;
    selected.add(url);
    out.push(url);
  }

  const removed = new Set(sitemapDiff?.removed ?? []);
  const stalePages = activePages.filter(
    (page) => !selected.has(page.url) && !removed.has(page.url),
  );
  for (const url of stalePageUrls(stalePages, now)) {
    if (out.length >= limit) break;
    selected.add(url);
    out.push(url);
  }

  return out;
}

/**
 * Persist page-level freshness after a monitor conditional check.
 *
 * @param input Page freshness update context.
 * @param input.db Database client.
 * @param input.siteId Site whose page was checked.
 * @param input.page Stored active page row.
 * @param input.result Conditional/hash check result.
 * @param input.now Current epoch second.
 */
export async function updateCheckedPage(input: {
  db: Database;
  siteId: string;
  page: ActivePage;
  result: MonitorCheckResult;
  now: number;
}): Promise<void> {
  if (input.result.outcome === "error") {
    await input.db
      .update(pages)
      .set({ lastCheckedAt: input.now })
      .where(and(eq(pages.siteId, input.siteId), eq(pages.url, input.page.url)));
    return;
  }

  const changed = checkChanged(input.result);
  await input.db
    .update(pages)
    .set({
      lastCheckedAt: input.now,
      lastChangedAt: changed ? input.now : input.page.lastChangedAt,
      pageCheckIntervalS: nextPageInterval(
        input.page.pageCheckIntervalS,
        changed,
        input.page.pageChangeStreak,
      ),
      pageChangeStreak: nextPageStreak(input.page.pageChangeStreak, changed),
    })
    .where(and(eq(pages.siteId, input.siteId), eq(pages.url, input.page.url)));
}
