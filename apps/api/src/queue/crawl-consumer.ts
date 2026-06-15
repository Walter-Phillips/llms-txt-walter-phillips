import { drizzle } from "drizzle-orm/d1";
import type { CrawlMessage, Environment } from "../bindings";
import type { CompleteRequest, CompleteResponse } from "../do/site-coordinator";
import { logError } from "../observability/logger";
import { captureHandledException } from "../observability/sentry";
import { handleDiscover } from "./crawl-discover-consumer";
import { handleGenerate } from "./crawl-generate-consumer";
import { enqueueGeneratedRun, fetchAndPersistPage } from "./crawl-page";
import {
  coordinator,
  doCall,
  enqueuePages,
  failRunAfterEnqueueFailure,
} from "./crawl-queue-helpers";

export { enqueuePages } from "./crawl-queue-helpers";

type PageMessage = Extract<CrawlMessage, { type: "page" }>;

async function handlePage(env: Environment, message: PageMessage): Promise<void> {
  const db = drizzle(env.DB);
  const now = Math.floor(Date.now() / 1000);
  const stub = coordinator(env, message.siteId);
  const links = await fetchAndPersistPage({ db, message, now });

  const completion = await doCall<CompleteResponse>(stub, "/complete", {
    runId: message.runId,
    url: message.url,
    links,
    depth: message.depth,
  } satisfies CompleteRequest);

  try {
    await enqueuePages({
      env,
      runId: message.runId,
      siteId: message.siteId,
      urls: completion.accepted,
      followLinks: message.followLinks === true,
    });
  } catch (error) {
    await failRunAfterEnqueueFailure({
      db,
      stub,
      runId: message.runId,
      context: "discovered pages",
      error,
    });
    return;
  }

  if (completion.drained) {
    await enqueueGeneratedRun({ db, env, message, completion });
  }
}

async function handleMessage(env: Environment, message: Message<CrawlMessage>): Promise<void> {
  switch (message.body.type) {
    case "discover":
      await handleDiscover(env, message.body);
      break;
    case "page":
      await handlePage(env, message.body);
      break;
    case "generate":
      await handleGenerate(env, message.body);
      break;
  }
}

function logMessageFailure(
  batch: MessageBatch<CrawlMessage>,
  message: Message<CrawlMessage>,
  error: unknown,
): void {
  captureHandledException(error, {
    workflow: "crawl",
    step: "queue_message",
    outcome: "retry",
    queue: batch.queue,
    messageType: message.body.type,
    siteId: message.body.siteId,
    runId: message.body.runId,
  });
  logError("crawl_message_failed", {
    workflow: "crawl",
    step: "queue_message",
    outcome: "retry",
    queue: batch.queue,
    messageType: message.body.type,
    siteId: message.body.siteId,
    runId: message.body.runId,
    error: error instanceof Error ? error : new Error(String(error)),
  });
}

/**
 * Process queued crawl messages and acknowledge or retry each one.
 * @param batch Queue batch delivered by Cloudflare.
 * @param env Worker bindings used by crawl handlers.
 * @param _ctx Worker execution context, currently unused.
 */
export async function handleCrawlBatch(
  batch: MessageBatch<CrawlMessage>,
  env: Environment,
  _ctx: ExecutionContext,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await handleMessage(env, message);
      message.ack();
    } catch (error) {
      logMessageFailure(batch, message, error);
      message.retry();
    }
  }
}
