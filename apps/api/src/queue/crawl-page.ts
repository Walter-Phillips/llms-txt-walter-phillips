import { and, eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { crawlRuns, pages } from "@profound-takehome/db";
import type { CrawlMessage, Environment } from "../bindings";
import { isHtml, politeFetch, type FetchResult } from "../crawler/fetcher";
import { extract } from "../crawler/extract";
import { classify } from "../generator/heuristics";

type Database = ReturnType<typeof drizzle>;
type PageMessage = Extract<CrawlMessage, { type: "page" }>;

interface PageWriteInput {
  db: Database;
  message: PageMessage;
  existingId: string | undefined;
  now: number;
}

interface StoredPage {
  id: string;
  etag: string | null;
  lastModified: string | null;
}

async function getStoredPage(db: Database, message: PageMessage): Promise<StoredPage | undefined> {
  return await db
    .select({ id: pages.id, etag: pages.etag, lastModified: pages.lastModified })
    .from(pages)
    .where(and(eq(pages.siteId, message.siteId), eq(pages.url, message.url)))
    .get();
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
    })
    .onConflictDoUpdate({
      target: [pages.siteId, pages.url],
      set: { status: "error", lastSeenAt: input.now },
    });
}

async function markPageActive(input: PageWriteInput): Promise<void> {
  await input.db
    .update(pages)
    .set({ status: "active", lastSeenAt: input.now })
    .where(and(eq(pages.siteId, input.message.siteId), eq(pages.url, input.message.url)));
}

async function persistHtmlPage(
  input: PageWriteInput & { body: ReadableStream<Uint8Array>; response: FetchResult },
): Promise<string[]> {
  const page = await extract(input.body);
  const path = new URL(input.message.url).pathname;
  const { section } = classify(path);
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
      status: "active",
      lastSeenAt: input.now,
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
        status: "active",
        lastSeenAt: input.now,
      },
    });
  return page.links;
}

async function handleFetchResponse(
  writeInput: PageWriteInput,
  response: FetchResult,
): Promise<string[] | undefined> {
  if (response.status === 304) {
    await markPageActive(writeInput);
  } else if (response.status === 200 && response.body && isHtml(response.contentType)) {
    return await persistHtmlPage({ ...writeInput, body: response.body, response });
  } else {
    await markPageError(writeInput);
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
    const response = await politeFetch(input.message.url, {
      etag: existing?.etag ?? undefined,
      lastModified: existing?.lastModified ?? undefined,
    });
    return await handleFetchResponse(writeInput, response);
  } catch {
    // Fetch/extract failure for one page must not fail the run.
    await markPageError(writeInput);
  }
  return undefined;
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
}
