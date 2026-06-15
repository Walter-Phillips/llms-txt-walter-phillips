import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { sites } from "@profound-takehome/db";
import { initialInterval, type CadenceSignals } from "../monitor/schedule";
import type { SitemapEntry } from "../crawler/sitemap";

/** Dated path segment like /2024/06/ — a strong blog/archive freshness signal. */
const DATED_URL = /\/\d{4}\/\d{2}\//;
/** A URL share above this counts the site as "dated" (blog-heavy). */
const DATED_URL_SHARE = 0.2;

/**
 * Derive freshness priors from data already in hand after discovery — no extra
 * fetches. `hasRss` stays unset because detecting a feed would mean another
 * network round-trip on the hot crawl path.
 * @param input Discovery inventory and sitemap metadata.
 * @param input.urls Accepted crawl URLs used to infer content freshness.
 * @param input.pageCount Number of accepted crawlable pages.
 * @param input.isNewsSitemap Whether discovery used a news sitemap.
 * @returns Cadence signals for the monitor scheduler.
 */
export function deriveSignals(input: {
  urls: string[];
  pageCount: number;
  isNewsSitemap: boolean;
}): CadenceSignals {
  const dated = input.urls.filter((url) => DATED_URL.test(url)).length;
  const hasDatedUrls = input.urls.length > 0 && dated / input.urls.length >= DATED_URL_SHARE;
  return {
    pageCount: input.pageCount,
    hasNewsSitemap: input.isNewsSitemap,
    hasDatedUrls,
  };
}

/**
 * Persist the first-check interval prior — but only on the site's initial
 * crawl. Re-crawls leave the stored interval alone so adaptive tuning survives.
 * @param input Cadence prior context.
 * @param input.db Database client with update support.
 * @param input.siteId Site whose cadence may be initialized.
 * @param input.trigger Run trigger that decides whether this is the first crawl.
 * @param input.signals Discovery signals used to choose the interval.
 * @param input.now Optional current epoch second used by tests.
 */
export async function applyCadencePrior(input: {
  db: Pick<ReturnType<typeof drizzle>, "update">;
  siteId: string;
  trigger: string | undefined;
  signals: Parameters<typeof deriveSignals>[0];
  now?: number;
}): Promise<void> {
  if (input.trigger !== "initial") return;
  const interval = initialInterval(deriveSignals(input.signals));
  await input.db
    .update(sites)
    .set({
      checkIntervalS: interval,
      nextCheckAt: (input.now ?? Math.floor(Date.now() / 1000)) + interval,
    })
    .where(eq(sites.id, input.siteId));
}

/**
 * Rewrite a clean single-foreign-origin sitemap onto the entered origin.
 * Mixed, unparseable, and already-same-origin sets keep their original URLs so
 * the frontier still drops genuinely external URLs.
 * @param entries Sitemap entries discovered for the site.
 * @param origin User-entered site origin.
 * @returns Sitemap entries, possibly rewritten onto the entered origin.
 */
export function aliasSitemapEntries(entries: SitemapEntry[], origin: string): SitemapEntry[] {
  const enteredOrigin = new URL(origin).origin;
  const origins = new Set<string>();
  for (const entry of entries) {
    try {
      origins.add(new URL(entry.url).origin);
    } catch {
      // Skip unparseable urls when counting distinct origins.
    }
  }

  if (origins.size !== 1) return entries;
  const [only] = origins;
  if (only === enteredOrigin) return entries;

  return entries.map((entry) => {
    try {
      const parsed = new URL(entry.url);
      return { ...entry, url: `${enteredOrigin}${parsed.pathname}${parsed.search}${parsed.hash}` };
    } catch {
      return entry;
    }
  });
}
