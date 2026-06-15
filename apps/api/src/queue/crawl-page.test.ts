import { crawlRuns } from "@profound-takehome/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Environment } from "../bindings";
import { politeFetch } from "../crawler/fetcher";
import { extract } from "../crawler/extract";
import { createTestEnvironment, FakeDatabase } from "../test-helpers";
import { enqueueGeneratedRun, fetchAndPersistPage } from "./crawl-page";

vi.mock("../crawler/fetcher", () => ({
  politeFetch: vi.fn(),
  isHtml: (contentType: string | null) => /text\/html/i.test(contentType ?? ""),
}));

vi.mock("../crawler/extract", () => ({
  extract: vi.fn(),
}));

const htmlResponse = {
  status: 200,
  body: new ReadableStream<Uint8Array>(),
  etag: '"new"',
  lastModified: "Mon, 15 Jun 2026 00:00:00 GMT",
  contentType: "text/html; charset=utf-8",
  contentEncoding: null,
};

function fetchDatabaseWithStoredPage(
  stored: object,
): ReturnType<typeof createTestEnvironment>["DB"] {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          get: () => Promise.resolve(stored),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => Promise.resolve(),
      }),
    }),
  } as unknown as ReturnType<typeof createTestEnvironment>["DB"];
}

describe("fetchAndPersistPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(politeFetch).mockResolvedValue(htmlResponse);
    vi.mocked(extract).mockResolvedValue({
      title: "Example",
      description: "Example description",
      h1: "Example",
      snippet: "Example snippet",
      contentHash: "hash",
      links: ["/docs"],
    });
  });

  it("does not send conditional validators when link discovery still needs page links", async () => {
    const db = fetchDatabaseWithStoredPage({
      id: "page_home",
      etag: '"old"',
      lastModified: "Sun, 14 Jun 2026 00:00:00 GMT",
    });

    const links = await fetchAndPersistPage({
      db: db as never,
      now: 100,
      message: {
        type: "page",
        runId: "run_1",
        siteId: "site_1",
        url: "https://example.com/",
        depth: 0,
        followLinks: true,
      },
    });

    expect(politeFetch).toHaveBeenCalledWith("https://example.com/", {});
    expect(links).toEqual(["/docs"]);
  });

  it("keeps conditional validators when the page is not expanding the link frontier", async () => {
    const db = fetchDatabaseWithStoredPage({
      id: "page_home",
      etag: '"old"',
      lastModified: "Sun, 14 Jun 2026 00:00:00 GMT",
    });

    await fetchAndPersistPage({
      db: db as never,
      now: 100,
      message: {
        type: "page",
        runId: "run_1",
        siteId: "site_1",
        url: "https://example.com/",
        depth: 0,
        followLinks: false,
      },
    });

    expect(politeFetch).toHaveBeenCalledWith("https://example.com/", {
      etag: '"old"',
      lastModified: "Sun, 14 Jun 2026 00:00:00 GMT",
    });
  });
});

describe("enqueueGeneratedRun", () => {
  it("retires active pages missed by a drained successful crawl before generation", async () => {
    const db = new FakeDatabase();
    db.queueSelect(crawlRuns, { startedAt: 100 });
    const send = vi.fn(() => Promise.resolve(undefined));
    const env = createTestEnvironment(db, {
      CRAWL_QUEUE: { send } as unknown as Environment["CRAWL_QUEUE"],
    });

    await enqueueGeneratedRun({
      db: db as never,
      env,
      message: {
        type: "page",
        runId: "run_1",
        siteId: "site_1",
        url: "https://example.com/",
        depth: 0,
      },
      completion: {
        pagesFound: 1,
        pagesCrawled: 1,
        capped: false,
      },
    });

    expect(db.updates).toEqual([
      { table: "pages", values: { status: "removed" } },
      {
        table: "crawlRuns",
        values: {
          status: "generating",
          pagesFound: 1,
          pagesCrawled: 1,
        },
      },
    ]);
    expect(send).toHaveBeenCalledWith({
      type: "generate",
      runId: "run_1",
      siteId: "site_1",
    });
  });
});
