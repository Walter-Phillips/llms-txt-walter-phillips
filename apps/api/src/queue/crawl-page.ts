import { and, eq, lt } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { crawlRuns, pages } from "@profound-takehome/db";
import type { CrawlMessage, Environment } from "../bindings";
import { isHtml, politeFetch, type FetchResult } from "../crawler/fetcher";
import { extract } from "../crawler/extract";
import { MAX_DEPTH } from "../crawler/frontier";
import { classify } from "../generator/heuristics";
import { cachedLinks, fetchedFreshness, unchangedFreshness, type StoredPage } from "./page-cache";
import { logInfo, logWarn, urlFields } from "../observability/logger";

type Database = ReturnType<typeof drizzle>;
type PageMessage = Extract<CrawlMessage, { type: "page" }>;

interface PageWriteInput {
  db: Database;
  message: PageMessage;
  existingId: string | undefined;
  now: number;
}

function logPageOutcome(
  message: PageMessage,
  outcome: string,
  fields: Record<string, string | number | boolean | null> = {},
): void {
  logInfo("crawl_page_fetched", {
    workflow: "crawl",
    step: "page_fetch",
    outcome,
    siteId: message.siteId,
    runId: message.runId,
    depth: message.depth,
    ...urlFields(message.url),
    ...fields,
  });
}

async function getStoredPage(db: Database, message: PageMessage): Promise<StoredPage | undefined> {
  return await db
    .select({
      id: pages.id,
      etag: pages.etag,
      lastModified: pages.lastModified,
      contentHash: pages.contentHash,
      outLinksJson: pages.outLinksJson,
      lastChangedAt: pages.lastChangedAt,
      pageCheckIntervalS: pages.pageCheckIntervalS,
      pageChangeStreak: pages.pageChangeStreak,
    })
    .from(pages)
    .where(and(eq(pages.siteId, message.siteId), eq(pages.url, message.url)))
    .get();
}

function fetchOptionsForPage(
  message: PageMessage,
  existing: StoredPage | undefined,
): {
  etag?: string;
  lastModified?: string;
} {
  if (message.followLinks === true && message.depth < MAX_DEPTH && !cachedLinks(existing)) {
    return {};
  }
  return {
    etag: existing?.etag ?? undefined,
    lastModified: existing?.lastModified ?? undefined,
  };
}

async function markPageError(input: PageWriteInput): Promise<void> {
  await input.db
    .insert(pages)
    .values({
      id: input.existingId ?? nanoid(12),
      siteId: input.message.siteId,
      url: input.message.url,
      status: "error",
      lastSeenAt: input.now,
      lastCheckedAt: input.now,
    })
    .onConflictDoUpdate({
      target: [pages.siteId, pages.url],
      set: { status: "error", lastSeenAt: input.now, lastCheckedAt: input.now },
    });
}

async function markPageActive(
  input: PageWriteInput & { existing: StoredPage | undefined },
): Promise<void> {
  await input.db
    .update(pages)
    .set({
      status: "active",
      lastSeenAt: input.now,
      ...unchangedFreshness(input.existing, input.now),
    })
    .where(and(eq(pages.siteId, input.message.siteId), eq(pages.url, input.message.url)));
}

async function persistHtmlPage(
  input: PageWriteInput & {
    body: ReadableStream<Uint8Array>;
    existing: StoredPage | undefined;
    response: FetchResult;
  },
): Promise<string[]> {
  const page = await extract(input.body);
  const path = new URL(input.message.url).pathname;
  const { section } = classify(path);
  const freshness = fetchedFreshness(input.existing, page.contentHash, input.now);
  await input.db
    .insert(pages)
    .values({
      id: input.existingId ?? nanoid(12),
      siteId: input.message.siteId,
      url: input.message.url,
      title: page.title,
      description: page.description,
      h1: page.h1,
      snippet: page.snippet,
      sectionHint: section,
      contentHash: page.contentHash,
      etag: input.response.etag,
      lastModified: input.response.lastModified,
      outLinksJson: JSON.stringify(page.links),
      status: "active",
      lastSeenAt: input.now,
      ...freshness,
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
        etag: input.response.etag,
        lastModified: input.response.lastModified,
        outLinksJson: JSON.stringify(page.links),
        status: "active",
        lastSeenAt: input.now,
        ...freshness,
      },
    });
  return page.links;
}

async function handleFetchResponse(
  writeInput: PageWriteInput,
  existing: StoredPage | undefined,
  response: FetchResult,
): Promise<string[] | undefined> {
  if (response.status === 304) {
    const links = cachedLinks(existing);
    await markPageActive({ ...writeInput, existing });
    logPageOutcome(writeInput.message, "unchanged", {
      status: response.status,
      cacheOutcome: links ? "revalidated_304_cached_links" : "revalidated_304",
    });
    return links ?? undefined;
  } else if (response.status === 200 && response.body && isHtml(response.contentType)) {
    const links = await persistHtmlPage({ ...writeInput, body: response.body, existing, response });
    logPageOutcome(writeInput.message, "active", {
      status: response.status,
      linkCount: links.length,
      cacheOutcome: existing ? "revalidated_200" : "miss",
    });
    return links;
  } else {
    await markPageError(writeInput);
    logWarn("crawl_page_fetch_unusable", {
      workflow: "crawl",
      step: "page_fetch",
      outcome: "page_error",
      siteId: writeInput.message.siteId,
      runId: writeInput.message.runId,
      status: response.status,
      contentType: response.contentType,
      ...urlFields(writeInput.message.url),
    });
  }
  return undefined;
}

/**
 * Fetch one page and persist the active or error page row.
 * @param input Page fetch context.
 * @param input.db Database client.
 * @param input.message Page crawl message.
 * @param input.now Current epoch second.
 * @returns Discovered links when an HTML page was parsed.
 */
export async function fetchAndPersistPage(input: {
  db: Database;
  message: PageMessage;
  now: number;
}): Promise<string[] | undefined> {
  const existing = await getStoredPage(input.db, input.message);
  const writeInput = { ...input, existingId: existing?.id };

  try {
    const response = await politeFetch(
      input.message.url,
      fetchOptionsForPage(input.message, existing),
    );
    return await handleFetchResponse(writeInput, existing, response);
  } catch {
    // Fetch/extract failure for one page must not fail the run.
    await markPageError(writeInput);
    logWarn("crawl_page_fetch_failed", {
      workflow: "crawl",
      step: "page_fetch",
      outcome: "page_error",
      siteId: input.message.siteId,
      runId: input.message.runId,
      ...urlFields(input.message.url),
    });
  }
  return undefined;
}

async function retirePagesMissedByRun(db: Database, message: PageMessage): Promise<void> {
  const run = await db
    .select({ startedAt: crawlRuns.startedAt })
    .from(crawlRuns)
    .where(eq(crawlRuns.id, message.runId))
    .get();
  if (run?.startedAt === null || run?.startedAt === undefined) return;

  await db
    .update(pages)
    .set({ status: "removed" })
    .where(
      and(
        eq(pages.siteId, message.siteId),
        eq(pages.status, "active"),
        lt(pages.lastSeenAt, run.startedAt),
      ),
    );
}

/**
 * Mark a drained run as generating and enqueue the generator message.
 * @param input Generator enqueue context.
 * @param input.db Database client.
 * @param input.env Worker bindings containing the crawl queue.
 * @param input.message Completed page message.
 * @param input.completion Durable Object completion response.
 * @param input.completion.pagesFound Total pages admitted by the coordinator.
 * @param input.completion.pagesCrawled Total pages completed by the coordinator.
 * @param input.completion.capped Whether the crawl stopped at the page cap.
 */
export async function enqueueGeneratedRun(input: {
  db: Database;
  env: Environment;
  message: PageMessage;
  completion: {
    pagesFound: number;
    pagesCrawled: number;
    capped: boolean;
  };
}): Promise<void> {
  await retirePagesMissedByRun(input.db, input.message);

  await input.db
    .update(crawlRuns)
    .set({
      status: "generating",
      pagesFound: input.completion.pagesFound,
      pagesCrawled: input.completion.pagesCrawled,
      ...(input.completion.capped ? { capReason: "max_pages" } : {}),
    })
    .where(eq(crawlRuns.id, input.message.runId));
  await input.env.CRAWL_QUEUE.send({
    type: "generate",
    runId: input.message.runId,
    siteId: input.message.siteId,
  });
  logInfo("crawl_generation_queued", {
    workflow: "crawl",
    step: "enqueue_generation",
    outcome: "queued",
    siteId: input.message.siteId,
    runId: input.message.runId,
    pagesFound: input.completion.pagesFound,
    pagesCrawled: input.completion.pagesCrawled,
    capped: input.completion.capped,
  });
}
