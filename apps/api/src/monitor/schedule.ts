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

/**
 * Adaptive cadence math — pure, easy to unit test.
 * - changes found → halve interval (floor 1h)
 * - no changes    → 1.5× interval (ceiling 7d)
 */
export function nextInterval(currentS: number, changesFound: boolean): number {
  const HOUR = 3600;
  const WEEK = 7 * 24 * HOUR;
  if (changesFound) return Math.max(Math.floor(currentS / 2), HOUR);
  return Math.min(Math.floor(currentS * 1.5), WEEK);
}

// Hint for tsc that `sql` is intentionally available for raw queries later.
void sql;
