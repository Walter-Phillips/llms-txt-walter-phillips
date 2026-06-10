import type { Env, MonitorMessage } from "../bindings";

/**
 * monitor-queue consumer. For each due site:
 *   1. Sitemap diff (cheap signal)
 *   2. Conditional GETs (ETag/Last-Modified) for candidates
 *   3. Content-hash compare for anything actually re-fetched
 * If a structural or metadata change is detected, re-enqueue affected pages
 * for the standard crawl pipeline and trigger regeneration.
 *
 * Adaptive cadence: update next_check_at based on whether changes were found.
 */
export async function handleMonitorBatch(
  batch: MessageBatch<MonitorMessage>,
  _env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  for (const msg of batch.messages) {
    try {
      // TODO: monitor/detect.ts + monitor/schedule.ts
      msg.ack();
    } catch (err) {
      console.error("monitor handler failed", msg.body, err);
      msg.retry();
    }
  }
}
