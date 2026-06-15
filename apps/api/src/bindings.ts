export type CrawlMessage =
  | { type: "discover"; runId: string; siteId: string; url: string }
  | {
      type: "page";
      runId: string;
      siteId: string;
      url: string;
      depth: number;
      /** True when this page body is needed to expand the link frontier. */
      followLinks?: boolean;
    }
  | { type: "generate"; runId: string; siteId: string };

export interface BrowserRunBinding {
  quickAction(
    action: "snapshot",
    input: {
      url: string;
      formats: ["content", "markdown"];
      gotoOptions: {
        waitUntil: "networkidle";
        timeout: number;
      };
    },
  ): Promise<Response>;
}

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
  BROWSER?: BrowserRunBinding;
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
