import * as Sentry from "@sentry/cloudflare";
import { app } from "./app";
import type { CrawlMessage, Environment, MonitorMessage } from "./bindings";
import { handleCrawlBatch } from "./queue/crawl-consumer";
import { handleMonitorBatch } from "./queue/monitor-consumer";
import { enqueueDueMonitorJobs } from "./monitor/schedule";
import { logError, logInfo } from "./observability/logger";
import { withObservabilityContext } from "./observability/context";

export { SiteCoordinator } from "./do/site-coordinator";

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function sentryTraceRate(env: Environment): number {
  const configured = Number.parseFloat(env.SENTRY_TRACES_SAMPLE_RATE ?? "");
  return Number.isFinite(configured) && configured >= 0 && configured <= 1 ? configured : 0;
}

async function dispatchQueue(
  batch: MessageBatch<CrawlMessage | MonitorMessage>,
  env: Environment,
  ctx: ExecutionContext,
): Promise<void> {
  logInfo("queue_batch_received", {
    workflow: "queue",
    step: "dispatch",
    outcome: "started",
    queue: batch.queue,
    messageCount: batch.messages.length,
  });

  try {
    if (batch.queue === "crawl-queue") {
      await handleCrawlBatch(batch as MessageBatch<CrawlMessage>, env, ctx);
    } else if (batch.queue === "monitor-queue") {
      await handleMonitorBatch(batch as MessageBatch<MonitorMessage>, env, ctx);
    }
  } catch (error) {
    Sentry.captureException(asError(error));
    throw error;
  }

  logInfo("queue_batch_completed", {
    workflow: "queue",
    step: "dispatch",
    outcome: "completed",
    queue: batch.queue,
    messageCount: batch.messages.length,
  });
}

async function runScheduledMonitor(env: Environment): Promise<void> {
  try {
    await enqueueDueMonitorJobs(env);
  } catch (error) {
    Sentry.captureException(asError(error));
    logError("monitor_cron_failed", {
      workflow: "monitor",
      step: "cron_enqueue",
      outcome: "failed",
      error: asError(error),
    });
    throw error;
  }
}

const handler = {
  fetch(request: Request, env: Environment, ctx: ExecutionContext): Response | Promise<Response> {
    return withObservabilityContext({ env, executionContext: ctx }, () =>
      app.fetch(request, env, ctx),
    );
  },

  async queue(
    batch: MessageBatch<CrawlMessage | MonitorMessage>,
    env: Environment,
    ctx: ExecutionContext,
  ): Promise<void> {
    await withObservabilityContext({ env, executionContext: ctx }, () =>
      dispatchQueue(batch, env, ctx),
    );
  },

  scheduled(_controller: ScheduledController, env: Environment, ctx: ExecutionContext): void {
    ctx.waitUntil(
      withObservabilityContext({ env, executionContext: ctx }, () => runScheduledMonitor(env)),
    );
  },
} satisfies ExportedHandler<Environment, CrawlMessage | MonitorMessage>;

export default Sentry.withSentry<Environment, CrawlMessage | MonitorMessage>(
  (env: Environment) =>
    env.SENTRY_DSN
      ? {
          dsn: env.SENTRY_DSN,
          tracesSampleRate: sentryTraceRate(env),
        }
      : undefined,
  handler,
);
