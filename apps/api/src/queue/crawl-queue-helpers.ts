import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { crawlRuns } from "@profound-takehome/db";
import type { Environment } from "../bindings";
import { captureHandledException } from "../observability/sentry";
import { logError } from "../observability/logger";

const QUEUE_SEND_BATCH_LIMIT = 100;

export type Database = ReturnType<typeof drizzle>;

export interface EnqueueFailureInput {
  db: Database;
  stub: DurableObjectStub;
  runId: string;
  context: string;
  error: unknown;
}

/**
 * Finds the Durable Object that coordinates a site's active crawl.
 * @param env Worker bindings with the Durable Object namespace.
 * @param siteId Site identifier used as the object name.
 * @returns Durable Object stub for the site.
 */
export function coordinator(env: Environment, siteId: string): DurableObjectStub {
  return env.SITE_COORDINATOR.get(env.SITE_COORDINATOR.idFromName(siteId));
}

/**
 * Calls a SiteCoordinator endpoint and parses the JSON response.
 * @param stub Durable Object stub.
 * @param path Endpoint path on the coordinator.
 * @param body JSON request body.
 * @returns Parsed response payload.
 */
export async function doCall<T>(stub: DurableObjectStub, path: string, body: unknown): Promise<T> {
  const res = await stub.fetch(`https://do${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`DO ${path} -> ${String(res.status)}: ${await res.text()}`);
  const payload = (await res.json()) as T;
  return payload;
}

/**
 * Stagger page fetches to stay polite without a per-domain scheduler.
 * @param input Page enqueue context.
 * @param input.env Worker bindings containing the crawl queue.
 * @param input.runId Crawl run receiving page messages.
 * @param input.siteId Site whose pages are being enqueued.
 * @param input.urls Accepted URLs with crawl depth.
 * @param input.followLinks Whether page bodies are needed for frontier expansion.
 */
export async function enqueuePages(input: {
  env: Environment;
  runId: string;
  siteId: string;
  urls: { url: string; depth: number }[];
  followLinks: boolean;
}): Promise<void> {
  if (input.urls.length === 0) return;
  const messages = input.urls.map(({ url, depth }, i) => ({
    body: {
      type: "page" as const,
      runId: input.runId,
      siteId: input.siteId,
      url,
      depth,
      followLinks: input.followLinks,
    },
    delaySeconds: Math.floor(i / 4),
  }));

  for (let start = 0; start < messages.length; start += QUEUE_SEND_BATCH_LIMIT) {
    await input.env.CRAWL_QUEUE.sendBatch(messages.slice(start, start + QUEUE_SEND_BATCH_LIMIT));
  }
}

/**
 * Marks a crawl as failed when downstream queue enqueueing fails.
 * @param input Failure context.
 */
export async function failRunAfterEnqueueFailure(input: EnqueueFailureInput): Promise<void> {
  const detail = input.error instanceof Error ? input.error.message : String(input.error);
  const { db, runId, stub } = input;
  await db
    .update(crawlRuns)
    .set({
      status: "error",
      error: `failed to enqueue ${input.context}: ${detail}`,
      finishedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(crawlRuns.id, runId));

  try {
    await doCall(stub, "/finish", { runId, phase: "error" });
  } catch (finishError) {
    captureHandledException(finishError, {
      workflow: "crawl",
      step: "enqueue",
      outcome: "failed",
      runId,
      context: input.context,
    });
    logError("crawl_enqueue_failure_finish_failed", {
      workflow: "crawl",
      step: "enqueue",
      outcome: "failed",
      runId,
      context: input.context,
      error: finishError instanceof Error ? finishError : new Error(String(finishError)),
    });
  }
  captureHandledException(input.error, {
    workflow: "crawl",
    step: "enqueue",
    outcome: "run_error",
    runId,
    context: input.context,
  });
  logError("crawl_enqueue_failed", {
    workflow: "crawl",
    step: "enqueue",
    outcome: "run_error",
    runId,
    context: input.context,
    error: input.error instanceof Error ? input.error : new Error(String(input.error)),
  });
}
