export type CrawlMessage =
  | { type: "discover"; runId: string; siteId: string; url: string }
  | { type: "page"; runId: string; siteId: string; url: string; depth: number }
  | { type: "generate"; runId: string; siteId: string };

export type MonitorMessage = { type: "check"; siteId: string };

export type Env = {
  DB: D1Database;
  FILES: R2Bucket;
  RATE_LIMIT: KVNamespace;
  CRAWL_QUEUE: Queue<CrawlMessage>;
  MONITOR_QUEUE: Queue<MonitorMessage>;
  SITE_COORDINATOR: DurableObjectNamespace;
  ANTHROPIC_API_KEY: string;
  APP_ORIGIN: string;
};
