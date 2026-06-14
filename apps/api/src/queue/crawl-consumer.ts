import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { crawlRuns, pages, sites } from "@profound-takehome/db";
import type { CrawlMessage, Env } from "../bindings";
import { fetchRobots } from "../crawler/robots";
import { discoverSitemapEntries } from "../crawler/sitemap";
import { politeFetch, isHtml } from "../crawler/fetcher";
import { extract } from "../crawler/extract";
import { classify } from "../generator/heuristics";
import { generate } from "../generator";
import { initialInterval, type CadenceSignals } from "../monitor/schedule";
import type {
  ClaimRequest,
  CompleteRequest,
  CompleteResponse,
  SeedRequest,
  SeedResponse,
} from "../do/site-coordinator";

const MIN_SITEMAP_URLS = 3;

/** Dated path segment like /2024/06/ — a strong blog/archive freshness signal. */
const DATED_URL = /\/\d{4}\/\d{2}\//;
/** A URL share above this counts the site as "dated" (blog-heavy). */
const DATED_URL_SHARE = 0.2;

/**
 * Derive freshness priors from data already in hand after discovery — no extra
 * fetches. `hasRss` stays unset because detecting a feed would mean another
 * network round-trip on the hot crawl path.
 */
export function deriveSignals(input: {
  urls: string[];
  pageCount: number;
  isNewsSitemap: boolean;
}): CadenceSignals {
  const dated = input.urls.filter((u) => DATED_URL.test(u)).length;
  const hasDatedUrls = input.urls.length > 0 && dated / input.urls.length >= DATED_URL_SHARE;
  return {
    pageCount: input.pageCount,
    hasNewsSitemap: input.isNewsSitemap,
    hasDatedUrls,
  };
}

/**
 * Persist the first-check interval prior — but only on the site's initial
 * crawl. Re-crawls (manual or monitor-triggered) leave the stored interval
 * alone so the adaptive feedback loop's tuning survives.
 */
export async function applyCadencePrior(
  db: Pick<ReturnType<typeof drizzle>, "update">,
  siteId: string,
  trigger: string | undefined,
  signals: Parameters<typeof deriveSignals>[0],
): Promise<void> {
  if (trigger !== "initial") return;
  await db
    .update(sites)
    .set({ checkIntervalS: initialInterval(deriveSignals(signals)) })
    .where(eq(sites.id, siteId));
}

function coordinator(env: Env, siteId: string): DurableObjectStub {
  return env.SITE_COORDINATOR.get(env.SITE_COORDINATOR.idFromName(siteId));
}

async function doCall<T>(stub: DurableObjectStub, path: string, body: unknown): Promise<T> {
  const res = await stub.fetch(`https://do${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`DO ${path} → ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

/** Stagger page fetches to stay polite without a per-domain scheduler. */
async function enqueuePages(
  env: Env,
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

async function failRunAfterEnqueueFailure(
  db: ReturnType<typeof drizzle>,
  stub: DurableObjectStub,
  runId: string,
  context: string,
  err: unknown,
): Promise<void> {
  const detail = err instanceof Error ? err.message : String(err);
  await db
    .update(crawlRuns)
    .set({
      status: "error",
      error: `failed to enqueue ${context}: ${detail}`,
      finishedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(crawlRuns.id, runId));

  try {
    await doCall(stub, "/finish", { runId, phase: "error" });
  } catch (finishErr) {
    console.error("failed to mark DO run error after enqueue failure", { runId, finishErr });
  }
}

async function handleDiscover(
  env: Env,
  msg: Extract<CrawlMessage, { type: "discover" }>,
): Promise<void> {
  const db = drizzle(env.DB);
  const now = Math.floor(Date.now() / 1000);
  const origin = msg.url;

  const robots = await fetchRobots(origin);
  const sitemap = await discoverSitemapEntries(origin, robots.sitemaps);

  const useSitemap = sitemap.entries.length >= MIN_SITEMAP_URLS;
  const discoveryMethod = useSitemap ? "sitemap" : "links";

  const stub = coordinator(env, msg.siteId);
  const claim = await stub.fetch("https://do/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      runId: msg.runId,
      origin,
      disallow: robots.disallow,
      discoveryMethod,
      followLinks: !useSitemap,
    } satisfies ClaimRequest),
  });
  if (claim.status === 409) {
    await db
      .update(crawlRuns)
      .set({ status: "error", error: "another run is in progress for this site", finishedAt: now })
      .where(eq(crawlRuns.id, msg.runId));
    return;
  }
  if (!claim.ok) throw new Error(`DO claim → ${claim.status}`);

  const candidates = useSitemap ? sitemap.entries.map((e) => e.url) : [`${origin}/`];
  const seeded = await doCall<SeedResponse>(stub, "/seed", {
    runId: msg.runId,
    urls: candidates,
    baseUrl: origin,
    depth: 0,
  } satisfies SeedRequest);

  // Persist sitemap lastmod per page now — it's the cheapest monitoring signal
  // later, and the page consumer doesn't see sitemap data.
  if (useSitemap) {
    const lastmodByUrl = new Map(sitemap.entries.map((e) => [e.url, e.lastmod ?? null]));
    const statements = seeded.accepted
      .filter(({ url }) => lastmodByUrl.get(url) !== undefined)
      .map(({ url }) =>
        db
          .insert(pages)
          .values({
            id: nanoid(12),
            siteId: msg.siteId,
            url,
            sitemapLastmod: lastmodByUrl.get(url) ?? null,
            status: "active",
            lastSeenAt: now,
          })
          .onConflictDoUpdate({
            target: [pages.siteId, pages.url],
            set: { sitemapLastmod: lastmodByUrl.get(url) ?? null, status: "active" },
          }),
      );
    for (let i = 0; i < statements.length; i += 20) {
      const chunk = statements.slice(i, i + 20);
      await db.batch([chunk[0]!, ...chunk.slice(1)]);
    }
  }

  await db
    .update(crawlRuns)
    .set({
      status: "crawling",
      discoveryMethod,
      pagesFound: seeded.accepted.length,
      startedAt: now,
    })
    .where(eq(crawlRuns.id, msg.runId));

  // Set the adaptive-cadence prior only on a site's first crawl. Monitor and
  // manual re-crawls must not clobber an interval the feedback loop has tuned.
  const run = await db
    .select({ trigger: crawlRuns.trigger })
    .from(crawlRuns)
    .where(eq(crawlRuns.id, msg.runId))
    .get();
  await applyCadencePrior(db, msg.siteId, run?.trigger, {
    urls: seeded.accepted.map((p) => p.url),
    pageCount: seeded.accepted.length,
    isNewsSitemap: useSitemap && sitemap.isNews,
  });

  if (seeded.accepted.length === 0) {
    await db
      .update(crawlRuns)
      .set({ status: "error", error: "no crawlable pages found", finishedAt: now })
      .where(eq(crawlRuns.id, msg.runId));
    await doCall(stub, "/finish", { runId: msg.runId, phase: "error" });
    return;
  }

  try {
    await enqueuePages(env, msg.runId, msg.siteId, seeded.accepted);
  } catch (err) {
    await failRunAfterEnqueueFailure(db, stub, msg.runId, "seed pages", err);
    return;
  }
}

async function handlePage(env: Env, msg: Extract<CrawlMessage, { type: "page" }>): Promise<void> {
  const db = drizzle(env.DB);
  const now = Math.floor(Date.now() / 1000);
  const stub = coordinator(env, msg.siteId);

  const existing = await db
    .select()
    .from(pages)
    .where(and(eq(pages.siteId, msg.siteId), eq(pages.url, msg.url)))
    .get();

  const markError = () =>
    db
      .insert(pages)
      .values({
        id: existing?.id ?? nanoid(12),
        siteId: msg.siteId,
        url: msg.url,
        status: "error",
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: [pages.siteId, pages.url],
        set: { status: "error", lastSeenAt: now },
      });

  let links: string[] | undefined;
  try {
    const res = await politeFetch(msg.url, {
      etag: existing?.etag ?? undefined,
      lastModified: existing?.lastModified ?? undefined,
    });

    if (res.status === 304) {
      await db
        .update(pages)
        .set({ status: "active", lastSeenAt: now })
        .where(and(eq(pages.siteId, msg.siteId), eq(pages.url, msg.url)));
    } else if (res.status === 200 && res.body && isHtml(res.contentType)) {
      const page = await extract(res.body);
      links = page.links;
      const path = new URL(msg.url).pathname;
      const { section } = classify(path);
      await db
        .insert(pages)
        .values({
          id: existing?.id ?? nanoid(12),
          siteId: msg.siteId,
          url: msg.url,
          title: page.title,
          description: page.description,
          h1: page.h1,
          snippet: page.snippet,
          sectionHint: section,
          contentHash: page.contentHash,
          etag: res.etag,
          lastModified: res.lastModified,
          status: "active",
          lastSeenAt: now,
        })
        .onConflictDoUpdate({
          target: [pages.siteId, pages.url],
          set: {
            title: page.title,
            description: page.description,
            h1: page.h1,
            snippet: page.snippet,
            sectionHint: section,
            contentHash: page.contentHash,
            etag: res.etag,
            lastModified: res.lastModified,
            status: "active",
            lastSeenAt: now,
          },
        });
    } else {
      await markError();
    }
  } catch {
    // Fetch/extract failure for one page must not fail the run.
    await markError();
  }

  const completion = await doCall<CompleteResponse>(stub, "/complete", {
    runId: msg.runId,
    url: msg.url,
    links,
    depth: msg.depth,
  } satisfies CompleteRequest);

  try {
    await enqueuePages(env, msg.runId, msg.siteId, completion.accepted);
  } catch (err) {
    await failRunAfterEnqueueFailure(db, stub, msg.runId, "discovered pages", err);
    return;
  }

  if (completion.drained) {
    await db
      .update(crawlRuns)
      .set({
        status: "generating",
        pagesFound: completion.pagesFound,
        pagesCrawled: completion.pagesCrawled,
      })
      .where(eq(crawlRuns.id, msg.runId));
    await env.CRAWL_QUEUE.send({ type: "generate", runId: msg.runId, siteId: msg.siteId });
  }
}

async function handleGenerate(
  env: Env,
  msg: Extract<CrawlMessage, { type: "generate" }>,
): Promise<void> {
  const db = drizzle(env.DB);
  const stub = coordinator(env, msg.siteId);
  try {
    const run = await db.select().from(crawlRuns).where(eq(crawlRuns.id, msg.runId)).get();
    await generate(env, msg.siteId, msg.runId, run?.changeSummary ?? undefined);
    await doCall(stub, "/finish", { runId: msg.runId, phase: "done" });
  } catch (err) {
    await db
      .update(crawlRuns)
      .set({
        status: "error",
        error: err instanceof Error ? err.message : "generation failed",
        finishedAt: Math.floor(Date.now() / 1000),
      })
      .where(eq(crawlRuns.id, msg.runId));
    await doCall(stub, "/finish", { runId: msg.runId, phase: "error" });
  }
}

export async function handleCrawlBatch(
  batch: MessageBatch<CrawlMessage>,
  env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  for (const msg of batch.messages) {
    try {
      switch (msg.body.type) {
        case "discover":
          await handleDiscover(env, msg.body);
          break;
        case "page":
          await handlePage(env, msg.body);
          break;
        case "generate":
          await handleGenerate(env, msg.body);
          break;
      }
      msg.ack();
    } catch (err) {
      console.error("crawl handler failed", msg.body, err);
      msg.retry();
    }
  }
}
