import { drizzle } from "drizzle-orm/d1";
import { and, eq, lte, sql } from "drizzle-orm";
import { sites } from "@profound-takehome/db";
import type { Env } from "../bindings";

/**
 * Cron entry point: find sites due for a monitor check and enqueue them.
 * Runs every 15 minutes per wrangler.toml triggers.crons.
 */
export async function enqueueDueMonitorJobs(env: Env): Promise<void> {
  const db = drizzle(env.DB);
  const now = Math.floor(Date.now() / 1000);

  const due = await db
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.monitoring, 1), lte(sites.nextCheckAt, now)))
    .limit(100);

  if (due.length === 0) return;

  await env.MONITOR_QUEUE.sendBatch(
    due.map((s) => ({ body: { type: "check" as const, siteId: s.id } })),
  );
}

const HOUR = 3600;
const WEEK = 7 * 24 * HOUR;

/**
 * Adaptive cadence math — pure, easy to unit test.
 * - changes found → halve interval (floor 1h)
 * - no changes    → 1.5× interval (ceiling 7d)
 */
export function nextInterval(currentS: number, changesFound: boolean): number {
  if (changesFound) return Math.max(Math.floor(currentS / 2), HOUR);
  return Math.min(Math.floor(currentS * 1.5), WEEK);
}

export type CadenceSignals = {
  hasNewsSitemap?: boolean;
  hasRss?: boolean;
  hasDatedUrls?: boolean;
  pageCount?: number;
};

/**
 * Prior for a site's first check interval, before adaptive feedback exists.
 * Strongest freshness signal wins:
 * - news sitemap or RSS feed → 6h (publishes often)
 * - dated URLs (blog-heavy)  → 12h
 * - tiny static site         → 72h (rarely changes)
 * - default                  → 24h
 */
export function initialInterval(signals: CadenceSignals): number {
  if (signals.hasNewsSitemap || signals.hasRss) return 6 * HOUR;
  if (signals.hasDatedUrls) return 12 * HOUR;
  if (signals.pageCount !== undefined && signals.pageCount <= 15) return 72 * HOUR;
  return 24 * HOUR;
}

/**
 * Streak bookkeeping: positive = consecutive checks that found changes,
 * negative = consecutive quiet checks. Sign flips reset the counter.
 */
export function nextStreak(current: number, changesFound: boolean): number {
  if (changesFound) return current > 0 ? current + 1 : 1;
  return current < 0 ? current - 1 : -1;
}

// Hint for tsc that `sql` is intentionally available for raw queries later.
void sql;
