import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { crawlRuns } from "@profound-takehome/db";
import type { CrawlMessage, Environment } from "../bindings";
import { generate } from "../generator";
import { logError, logInfo } from "../observability/logger";
import { captureHandledException } from "../observability/sentry";
import { coordinator, doCall } from "./crawl-queue-helpers";

type GenerateMessage = Extract<CrawlMessage, { type: "generate" }>;

function logGenerationStarted(message: GenerateMessage): void {
  logInfo("crawl_generation_started", {
    workflow: "generation",
    step: "queue_message",
    outcome: "started",
    siteId: message.siteId,
    runId: message.runId,
  });
}

function logGenerationCompleted(message: GenerateMessage): void {
  logInfo("crawl_generation_completed", {
    workflow: "generation",
    step: "queue_message",
    outcome: "completed",
    siteId: message.siteId,
    runId: message.runId,
  });
}

async function markGenerationError(
  env: Environment,
  message: GenerateMessage,
  error: unknown,
): Promise<void> {
  const db = drizzle(env.DB);
  const stub = coordinator(env, message.siteId);
  await db
    .update(crawlRuns)
    .set({
      status: "error",
      error: error instanceof Error ? error.message : "generation failed",
      finishedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(crawlRuns.id, message.runId));
  await doCall(stub, "/finish", { runId: message.runId, phase: "error" });
  logError("crawl_generation_failed", {
    workflow: "generation",
    step: "queue_message",
    outcome: "run_error",
    siteId: message.siteId,
    runId: message.runId,
    error: error instanceof Error ? error : new Error(String(error)),
  });
}

/**
 * Converts a drained crawl run into a published llms.txt version.
 * @param env Worker bindings.
 * @param message Generation queue message.
 */
export async function handleGenerate(env: Environment, message: GenerateMessage): Promise<void> {
  const db = drizzle(env.DB);
  const stub = coordinator(env, message.siteId);
  try {
    logGenerationStarted(message);
    const run = await db.select().from(crawlRuns).where(eq(crawlRuns.id, message.runId)).get();
    await generate(env, message.siteId, message.runId, run?.changeSummary ?? undefined);
    await doCall(stub, "/finish", { runId: message.runId, phase: "done" });
    logGenerationCompleted(message);
  } catch (error) {
    captureHandledException(error, {
      workflow: "generation",
      step: "queue_message",
      outcome: "run_error",
      siteId: message.siteId,
      runId: message.runId,
    });
    await markGenerationError(env, message, error);
  }
}
