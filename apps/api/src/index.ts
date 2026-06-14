import { app } from "./app";
import type { CrawlMessage, Env, MonitorMessage } from "./bindings";
import { handleCrawlBatch } from "./queue/crawl-consumer";
import { handleMonitorBatch } from "./queue/monitor-consumer";
import { enqueueDueMonitorJobs } from "./monitor/schedule";

export { SiteCoordinator } from "./do/site-coordinator";

export default {
  fetch: app.fetch,

  async queue(
    batch: MessageBatch<CrawlMessage | MonitorMessage>,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    if (batch.queue === "crawl-queue") {
      await handleCrawlBatch(batch as MessageBatch<CrawlMessage>, env, ctx);
    } else if (batch.queue === "monitor-queue") {
      await handleMonitorBatch(batch as MessageBatch<MonitorMessage>, env, ctx);
    }
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(enqueueDueMonitorJobs(env));
  }
} satisfies ExportedHandler<Env, CrawlMessage | MonitorMessage>;
