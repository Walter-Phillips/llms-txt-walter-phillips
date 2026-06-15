import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { crawlRuns } from "@profound-takehome/db";
import type { CrawlMessage, Environment } from "../bindings";
import { fetchRobots } from "../crawler/robots";
import { discoverSitemapEntries, type SitemapEntry } from "../crawler/sitemap";
import { generate } from "../generator";
import { logError, logInfo } from "../observability/logger";
import { captureHandledException } from "../observability/sentry";
import type {
  CompleteRequest,
  CompleteResponse,
  SeedRequest,
  SeedResponse,
} from "../do/site-coordinator";
import { aliasSitemapEntries } from "./crawl-discovery";
import {
  applyDiscoveryCadence,
  claimDiscovery,
  finishEmptyRun,
  markRunCrawling,
  persistSitemapPages,
} from "./crawl-discover-handler";
import { enqueueGeneratedRun, fetchAndPersistPage } from "./crawl-page";

const MIN_SITEMAP_URLS = 3;
const QUEUE_SEND_BATCH_LIMIT = 100;
type Database = ReturnType<typeof drizzle>;
type DiscoverMessage = Extract<CrawlMessage, { type: "discover" }>;
type PageMessage = Extract<CrawlMessage, { type: "page" }>;
type AcceptedUrl = SeedResponse["accepted"][number];

interface EnqueueFailureInput {
  db: Database;
  stub: DurableObjectStub;
  runId: string;
  context: string;
  error: unknown;
}

function coordinator(env: Environment, siteId: string): DurableObjectStub {
  return env.SITE_COORDINATOR.get(env.SITE_COORDINATOR.idFromName(siteId));
}

async function doCall<T>(stub: DurableObjectStub, path: string, body: unknown): Promise<T> {
  const res = await stub.fetch(`https://do${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`DO ${path} → ${String(res.status)}: ${await res.text()}`);
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

async function failRunAfterEnqueueFailure(input: EnqueueFailureInput): Promise<void> {
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

async function seedFrontier(input: {
  stub: DurableObjectStub;
  message: DiscoverMessage;
  origin: string;
  useSitemap: boolean;
  entries: { url: string }[];
}): Promise<SeedResponse> {
  const candidates = input.useSitemap
    ? input.entries.map((entry) => entry.url)
    : [`${input.origin}/`];
  return await doCall<SeedResponse>(input.stub, "/seed", {
    runId: input.message.runId,
    urls: candidates,
    baseUrl: input.origin,
    depth: 0,
  } satisfies SeedRequest);
}

async function enqueueSeededPages(input: {
  db: Database;
  env: Environment;
  stub: DurableObjectStub;
  message: DiscoverMessage;
  accepted: AcceptedUrl[];
  followLinks: boolean;
}): Promise<void> {
  try {
    await enqueuePages({
      env: input.env,
      runId: input.message.runId,
      siteId: input.message.siteId,
      urls: input.accepted,
      followLinks: input.followLinks,
    });
  } catch (error) {
    await failRunAfterEnqueueFailure({
      db: input.db,
      stub: input.stub,
      runId: input.message.runId,
      context: "seed pages",
      error,
    });
  }
}

function logDiscoverySkipped(message: DiscoverMessage, origin: string): void {
  logInfo("crawl_discovery_skipped", {
    workflow: "crawl",
    step: "discovery",
    outcome: "skipped",
    siteId: message.siteId,
    runId: message.runId,
    domain: origin,
  });
}

function logDiscoveryCompleted(input: {
  message: DiscoverMessage;
  origin: string;
  discoveryMethod: string;
  sitemapEntryCount: number;
  acceptedCount: number;
}): void {
  logInfo("crawl_discovery_completed", {
    workflow: "crawl",
    step: "discovery",
    outcome: "completed",
    siteId: input.message.siteId,
    runId: input.message.runId,
    domain: input.origin,
    discoveryMethod: input.discoveryMethod,
    sitemapEntryCount: input.sitemapEntryCount,
    acceptedCount: input.acceptedCount,
  });
}

async function persistDiscoveryState(input: {
  db: Database;
  message: DiscoverMessage;
  discoveryMethod: string;
  accepted: AcceptedUrl[];
  now: number;
  useSitemap: boolean;
  entries: SitemapEntry[];
  sitemapIsNews: boolean;
}): Promise<void> {
  if (input.useSitemap) {
    await persistSitemapPages({
      db: input.db,
      siteId: input.message.siteId,
      entries: input.entries,
      accepted: input.accepted,
      now: input.now,
    });
  }

  await markRunCrawling({
    db: input.db,
    message: input.message,
    discoveryMethod: input.discoveryMethod,
    accepted: input.accepted,
    now: input.now,
  });

  await applyDiscoveryCadence({
    db: input.db,
    message: input.message,
    accepted: input.accepted,
    isNewsSitemap: input.useSitemap && input.sitemapIsNews,
  });
}

async function handleDiscover(env: Environment, message: DiscoverMessage): Promise<void> {
  const db = drizzle(env.DB);
  const now = Math.floor(Date.now() / 1000);
  const origin = message.url;

  const robots = await fetchRobots(origin);
  const sitemap = await discoverSitemapEntries(origin, robots.sitemaps);

  // Rewrite canonical-host aliases (e.g. GitHub Pages custom domains) onto the
  // entered origin so the same-origin frontier accepts them downstream.
  const entries = aliasSitemapEntries(sitemap.entries, origin);

  const useSitemap = entries.length >= MIN_SITEMAP_URLS;
  const discoveryMethod = useSitemap ? "sitemap" : "links";

  const stub = coordinator(env, message.siteId);
  const claimed = await claimDiscovery({
    db,
    stub,
    message,
    now,
    origin,
    disallow: robots.disallow,
    discoveryMethod,
    useSitemap,
  });
  if (!claimed) {
    logDiscoverySkipped(message, origin);
    return;
  }

  const seeded = await seedFrontier({ stub, message, origin, useSitemap, entries });

  await persistDiscoveryState({
    db,
    message,
    discoveryMethod,
    accepted: seeded.accepted,
    now,
    useSitemap,
    entries,
    sitemapIsNews: sitemap.isNews,
  });
  logDiscoveryCompleted({
    message,
    origin,
    discoveryMethod,
    sitemapEntryCount: entries.length,
    acceptedCount: seeded.accepted.length,
  });

  if (seeded.accepted.length === 0) {
    await finishEmptyRun(db, stub, message.runId, now);
    return;
  }

  await enqueueSeededPages({
    db,
    env,
    stub,
    message,
    accepted: seeded.accepted,
    followLinks: !useSitemap,
  });
}

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

async function handleGenerate(
  env: Environment,
  message: Extract<CrawlMessage, { type: "generate" }>,
): Promise<void> {
  const db = drizzle(env.DB);
  const stub = coordinator(env, message.siteId);
  try {
    logInfo("crawl_generation_started", {
      workflow: "generation",
      step: "queue_message",
      outcome: "started",
      siteId: message.siteId,
      runId: message.runId,
    });
    const run = await db.select().from(crawlRuns).where(eq(crawlRuns.id, message.runId)).get();
    await generate(env, message.siteId, message.runId, run?.changeSummary ?? undefined);
    await doCall(stub, "/finish", { runId: message.runId, phase: "done" });
    logInfo("crawl_generation_completed", {
      workflow: "generation",
      step: "queue_message",
      outcome: "completed",
      siteId: message.siteId,
      runId: message.runId,
    });
  } catch (err) {
    captureHandledException(err, {
      workflow: "generation",
      step: "queue_message",
      outcome: "run_error",
      siteId: message.siteId,
      runId: message.runId,
    });
    await db
      .update(crawlRuns)
      .set({
        status: "error",
        error: err instanceof Error ? err.message : "generation failed",
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
      error: err instanceof Error ? err : new Error(String(err)),
    });
  }
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
      message.ack();
    } catch (err) {
      captureHandledException(err, {
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
        error: err instanceof Error ? err : new Error(String(err)),
      });
      message.retry();
    }
  }
}
