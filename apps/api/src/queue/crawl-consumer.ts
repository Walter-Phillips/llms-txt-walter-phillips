import type { CrawlMessage, Env } from "../bindings";

/**
 * crawl-queue dispatcher.
 *
 * Three message types:
 *  - discover: run Stages 0–3 (validate, robots, sitemap, BFS seed) and
 *    seed the SiteCoordinator frontier with page URLs.
 *  - page:     fetch one URL, extract metadata, hash content, upsert into D1,
 *    notify the DO of completion.
 *  - generate: drain triggers this — read inventory from D1, run Pass 1
 *    heuristics + Pass 2 LLM, validate, write versioned blob to R2.
 *
 * Each message is acked individually; failures retry via Queues semantics.
 */
export async function handleCrawlBatch(
  batch: MessageBatch<CrawlMessage>,
  _env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  for (const msg of batch.messages) {
    try {
      switch (msg.body.type) {
        case "discover":
          // TODO: implement discovery cascade (crawler/robots, crawler/sitemap, crawler/frontier).
          break;
        case "page":
          // TODO: implement fetch → extract → hash → upsert → DO notify.
          break;
        case "generate":
          // TODO: implement Pass 1 heuristics + Pass 2 LLM + validator + R2 write.
          break;
      }
      msg.ack();
    } catch (err) {
      console.error("crawl handler failed", msg.body, err);
      msg.retry();
    }
  }
}
