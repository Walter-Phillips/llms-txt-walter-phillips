export type CrawlMessage =
  | { type: "discover"; runId: string; siteId: string; url: string }
  | { type: "page"; runId: string; siteId: string; url: string; depth: number }
  | { type: "generate"; runId: string; siteId: string };

export interface MonitorMessage {
  type: "check";
  siteId: string;
}

export interface Environment {
  DB: D1Database;
  FILES: R2Bucket;
  RATE_LIMIT: KVNamespace;
  CRAWL_QUEUE: Queue<CrawlMessage>;
  MONITOR_QUEUE: Queue<MonitorMessage>;
  SITE_COORDINATOR: DurableObjectNamespace;
  ANTHROPIC_API_KEY: string;
  APP_ORIGIN: string;
  AXIOM_DATASET?: string;
  AXIOM_EDGE_URL?: string;
  AXIOM_ORG_ID?: string;
  AXIOM_TOKEN?: string;
  RATE_LIMIT_ENABLED?: string;
  SENTRY_DSN?: string;
  SENTRY_TRACES_SAMPLE_RATE?: string;
}

export type { Environment as Env };
