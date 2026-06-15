import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { crawlRuns } from "@profound-takehome/db";
import type { CrawlMessage, Environment } from "../bindings";
import { fetchRobots } from "../crawler/robots";
import { discoverSitemapEntries } from "../crawler/sitemap";
import { generate } from "../generator";
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
 * @param env Worker bindings containing the crawl queue.
 * @param runId Crawl run receiving page messages.
 * @param siteId Site whose pages are being enqueued.
 * @param urls Accepted URLs with crawl depth.
 */
async function enqueuePages(
  env: Environment,
  runId: string,
  siteId: string,
  urls: { url: string; depth: number }[],
): Promise<void> {
  if (urls.length === 0) return;
  await env.CRAWL_QUEUE.sendBatch(
    urls.map(({ url, depth }, i) => ({
      body: { type: "page" as const, runId, siteId, url, depth },
      delaySeconds: Math.floor(i / 4),
    })),
  );
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
    console.error("failed to mark DO run error after enqueue failure", {
      runId,
      finishErr: finishError,
    });
  }
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
}): Promise<void> {
  try {
    await enqueuePages(input.env, input.message.runId, input.message.siteId, input.accepted);
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
  if (!claimed) return;

  const seeded = await seedFrontier({ stub, message, origin, useSitemap, entries });

  // Persist sitemap lastmod per page now — it's the cheapest monitoring signal
  // later, and the page consumer doesn't see sitemap data.
  if (useSitemap) {
    await persistSitemapPages({
      db,
      siteId: message.siteId,
      entries,
      accepted: seeded.accepted,
      now,
    });
  }

  await markRunCrawling({ db, message, discoveryMethod, accepted: seeded.accepted, now });

  // Set the adaptive-cadence prior only on a site's first crawl. Monitor and
  // manual re-crawls must not clobber an interval the feedback loop has tuned.
  await applyDiscoveryCadence({
    db,
    message,
    accepted: seeded.accepted,
    isNewsSitemap: useSitemap && sitemap.isNews,
  });

  if (seeded.accepted.length === 0) {
    await finishEmptyRun(db, stub, message.runId, now);
    return;
  }

  await enqueueSeededPages({ db, env, stub, message, accepted: seeded.accepted });
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
    await enqueuePages(env, message.runId, message.siteId, completion.accepted);
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
    const run = await db.select().from(crawlRuns).where(eq(crawlRuns.id, message.runId)).get();
    await generate(env, message.siteId, message.runId, run?.changeSummary ?? undefined);
    await doCall(stub, "/finish", { runId: message.runId, phase: "done" });
  } catch (err) {
    await db
      .update(crawlRuns)
      .set({
        status: "error",
        error: err instanceof Error ? err.message : "generation failed",
        finishedAt: Math.floor(Date.now() / 1000),
      })
      .where(eq(crawlRuns.id, message.runId));
    await doCall(stub, "/finish", { runId: message.runId, phase: "error" });
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
      console.error("crawl handler failed", message.body, err);
      message.retry();
    }
  }
}
