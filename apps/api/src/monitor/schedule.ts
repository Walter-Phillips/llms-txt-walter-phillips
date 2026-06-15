import { drizzle } from "drizzle-orm/d1";
import { and, eq, lte } from "drizzle-orm";
import { sites } from "@profound-takehome/db";
import type { Environment } from "../bindings";
import { logInfo } from "../observability/logger";

/**
 * Cron entry point: find sites due for a monitor check and enqueue them.
 * Runs every 15 minutes per wrangler.toml triggers.crons.
 * @param env Worker bindings that provide D1 and the monitor queue.
 * @returns Resolves after due jobs are enqueued.
 */
export async function enqueueDueMonitorJobs(env: Environment): Promise<void> {
  const db = drizzle(env.DB);
  const now = Math.floor(Date.now() / 1000);

  const due = await db
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.monitoring, 1), lte(sites.nextCheckAt, now)))
    .limit(100);

  if (due.length === 0) {
    logInfo("monitor_due_sites_scanned", {
      workflow: "monitor",
      step: "cron_enqueue",
      outcome: "none_due",
      dueCount: 0,
    });
    return;
  }

  await env.MONITOR_QUEUE.sendBatch(
    due.map((s) => ({ body: { type: "check" as const, siteId: s.id } })),
  );
  logInfo("monitor_due_sites_enqueued", {
    workflow: "monitor",
    step: "cron_enqueue",
    outcome: "queued",
    dueCount: due.length,
  });
}

const HOUR = 3600;
const WEEK = 7 * 24 * HOUR;
const MONTH = 30 * 24 * HOUR;
export const DEFAULT_PAGE_CHECK_INTERVAL_S = WEEK;

/**
 * Adaptive cadence math — pure, easy to unit test. `streak` is the site's
 * change streak BEFORE this check (positive = consecutive changing checks,
 * negative = consecutive quiet checks); a strong streak (|streak| ≥ 3)
 * compounds the adjustment so we converge faster on a site's real cadence.
 * - changes found → ÷2, or ÷3 on a strong positive streak (floor 1h)
 * - no changes    → ×1.5, or ×2 on a strong negative streak (ceiling 7d)
 * @param currentS Current interval in seconds.
 * @param changesFound Whether the latest check found changes.
 * @param streak Previous consecutive change or quiet streak.
 * @returns Next interval in seconds.
 */
export function nextInterval(currentS: number, changesFound: boolean, streak: number): number {
  if (changesFound) {
    const divisor = streak >= 3 ? 3 : 2;
    return Math.max(Math.floor(currentS / divisor), HOUR);
  }
  const factor = streak <= -3 ? 2 : 1.5;
  return Math.min(Math.floor(currentS * factor), WEEK);
}

export interface CadenceSignals {
  hasNewsSitemap?: boolean;
  hasRss?: boolean;
  hasDatedUrls?: boolean;
  pageCount?: number;
}

/**
 * Prior for a site's first check interval, before adaptive feedback exists.
 * Strongest freshness signal wins:
 * - news sitemap or RSS feed → 6h (publishes often)
 * - dated URLs (blog-heavy)  → 12h
 * - tiny static site         → 72h (rarely changes)
 * - default                  → 24h
 * @param signals Freshness signals discovered during crawl.
 * @returns Initial monitor interval in seconds.
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
 * @param current Current persisted streak.
 * @param changesFound Whether the latest check found changes.
 * @returns Updated signed streak.
 */
export function nextStreak(current: number, changesFound: boolean): number {
  if (changesFound) return current > 0 ? current + 1 : 1;
  return current < 0 ? current - 1 : -1;
}

/**
 * Adaptive per-page revalidation cadence. Site-level cadence decides when a
 * monitor check runs; page-level cadence decides which pages fit inside that
 * check's bounded request budget.
 * - page changed → ÷2, or ÷3 on a strong positive streak (floor 6h)
 * - unchanged    → ×1.5, or ×2 on a strong negative streak (ceiling 30d)
 * @param currentS Current page interval in seconds.
 * @param changed Whether this page changed during the latest check.
 * @param streak Previous consecutive page change or quiet streak.
 * @returns Next page interval in seconds.
 */
export function nextPageInterval(currentS: number, changed: boolean, streak: number): number {
  if (changed) {
    const divisor = streak >= 3 ? 3 : 2;
    return Math.max(Math.floor(currentS / divisor), 6 * HOUR);
  }
  const factor = streak <= -3 ? 2 : 1.5;
  return Math.min(Math.floor(currentS * factor), MONTH);
}

/**
 * Per-page streak bookkeeping.
 * @param current Current persisted page streak.
 * @param changed Whether this page changed during the latest check.
 * @returns Updated signed page streak.
 */
export function nextPageStreak(current: number, changed: boolean): number {
  return nextStreak(current, changed);
}
