import { crawlRuns } from "@profound-takehome/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Environment } from "../bindings";
import { politeFetch } from "../crawler/fetcher";
import { extract } from "../crawler/extract";
import { renderWithBrowser } from "../crawler/rendered-fetcher";
import { createTestEnvironment, FakeDatabase } from "../test-helpers";
import { enqueueGeneratedRun, fetchAndPersistPage } from "./crawl-page";

vi.mock("../crawler/fetcher", () => ({
  politeFetch: vi.fn(),
  isHtml: (contentType: string | null) => /text\/html/i.test(contentType ?? ""),
}));

vi.mock("../crawler/extract", () => ({
  extract: vi.fn(),
}));

vi.mock("../crawler/rendered-fetcher", () => ({
  renderWithBrowser: vi.fn(),
}));

const htmlResponse = {
  status: 200,
  body: new ReadableStream<Uint8Array>(),
  etag: '"new"',
  lastModified: "Mon, 15 Jun 2026 00:00:00 GMT",
  contentType: "text/html; charset=utf-8",
  contentEncoding: null,
};

const notModifiedResponse = {
  status: 304,
  body: null,
  etag: '"old"',
  lastModified: "Sun, 14 Jun 2026 00:00:00 GMT",
  contentType: "text/html; charset=utf-8",
  contentEncoding: null,
};

function fetchDatabaseWithStoredPage(stored: object): {
  db: ReturnType<typeof createTestEnvironment>["DB"];
  inserts: Record<string, unknown>[];
  updates: Record<string, unknown>[];
} {
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          get: () => Promise.resolve(stored),
        }),
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: ({ set }: { set: Record<string, unknown> }) => {
          inserts.push(values);
          updates.push(set);
          return Promise.resolve();
        },
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          updates.push(values);
          return Promise.resolve();
        },
      }),
    }),
  } as unknown as ReturnType<typeof createTestEnvironment>["DB"];
  return { db, inserts, updates };
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
    vi.mocked(renderWithBrowser).mockResolvedValue(null);
  });

  it("does not send conditional validators when link discovery still needs page links", async () => {
    const { db } = fetchDatabaseWithStoredPage({
      id: "page_home",
      etag: '"old"',
      lastModified: "Sun, 14 Jun 2026 00:00:00 GMT",
      outLinksJson: null,
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

  it("uses cached links with conditional validators when link discovery gets a 304", async () => {
    vi.mocked(politeFetch).mockResolvedValue(notModifiedResponse);
    const { db, updates } = fetchDatabaseWithStoredPage({
      id: "page_home",
      etag: '"old"',
      lastModified: "Sun, 14 Jun 2026 00:00:00 GMT",
      outLinksJson: JSON.stringify(["/cached-docs"]),
      pageCheckIntervalS: 604_800,
      pageChangeStreak: 0,
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

    expect(politeFetch).toHaveBeenCalledWith("https://example.com/", {
      etag: '"old"',
      lastModified: "Sun, 14 Jun 2026 00:00:00 GMT",
    });
    expect(links).toEqual(["/cached-docs"]);
    expect(updates).toContainEqual({
      status: "active",
      lastSeenAt: 100,
      lastCheckedAt: 100,
      pageCheckIntervalS: 907_200,
      pageChangeStreak: -1,
    });
  });

  it("falls back to a full fetch when cached links are unreadable", async () => {
    const { db } = fetchDatabaseWithStoredPage({
      id: "page_home",
      etag: '"old"',
      lastModified: "Sun, 14 Jun 2026 00:00:00 GMT",
      outLinksJson: "{not json",
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
        followLinks: true,
      },
    });

    expect(politeFetch).toHaveBeenCalledWith("https://example.com/", {});
  });

  it("keeps conditional validators when the page is not expanding the link frontier", async () => {
    const { db } = fetchDatabaseWithStoredPage({
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

  it("stores extracted links and freshness metadata on a changed 200 HTML response", async () => {
    const { db, updates } = fetchDatabaseWithStoredPage({
      id: "page_home",
      etag: '"old"',
      lastModified: "Sun, 14 Jun 2026 00:00:00 GMT",
      contentHash: "old-hash",
      outLinksJson: JSON.stringify(["/old"]),
      lastChangedAt: 50,
      pageCheckIntervalS: 604_800,
      pageChangeStreak: 0,
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

    expect(updates).toContainEqual(
      expect.objectContaining({
        contentHash: "hash",
        outLinksJson: JSON.stringify(["/docs"]),
        lastCheckedAt: 100,
        lastChangedAt: 100,
        pageCheckIntervalS: 302_400,
        pageChangeStreak: 1,
      }),
    );
  });

  it("uses Browser Run output when static extraction is thin and render budget is claimed", async () => {
    vi.mocked(extract).mockResolvedValue({
      title: "App",
      description: null,
      h1: "Loading",
      snippet: null,
      contentHash: "static-hash",
      links: [],
    });
    vi.mocked(renderWithBrowser).mockResolvedValue({
      page: {
        title: "Example",
        description: "Rendered description",
        h1: "Example",
        snippet:
          "Rendered content includes enough useful page text to describe this route in the generated inventory.",
        contentHash: "rendered-hash",
        links: ["/docs", "/blog", "/projects"],
      },
      browserMsUsed: 1200,
    });
    const claimRender = vi.fn(() => Promise.resolve(true));
    const releaseRender = vi.fn(() => Promise.resolve());
    const browser = {} as NonNullable<Environment["BROWSER"]>;
    const { db, updates } = fetchDatabaseWithStoredPage({
      id: "page_home",
      etag: '"old"',
      lastModified: "Sun, 14 Jun 2026 00:00:00 GMT",
      contentHash: "old-hash",
      outLinksJson: JSON.stringify([]),
      lastChangedAt: 50,
      pageCheckIntervalS: 604_800,
      pageChangeStreak: 0,
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
      renderFallback: { browser, claimRender, releaseRender },
    });

    expect(claimRender).toHaveBeenCalledTimes(1);
    expect(releaseRender).not.toHaveBeenCalled();
    expect(renderWithBrowser).toHaveBeenCalledWith(browser, "https://example.com/");
    expect(links).toEqual(["/docs", "/blog", "/projects"]);
    expect(updates).toContainEqual(
      expect.objectContaining({
        title: "Example",
        description: "Rendered description",
        contentHash: "rendered-hash",
        outLinksJson: JSON.stringify(["/docs", "/blog", "/projects"]),
      }),
    );
  });

  it("keeps static output when Browser Run budget is exhausted", async () => {
    vi.mocked(extract).mockResolvedValue({
      title: "App",
      description: null,
      h1: "Loading",
      snippet: null,
      contentHash: "static-hash",
      links: [],
    });
    const claimRender = vi.fn(() => Promise.resolve(false));
    const releaseRender = vi.fn(() => Promise.resolve());
    const { db, updates } = fetchDatabaseWithStoredPage({
      id: "page_home",
      etag: '"old"',
      lastModified: "Sun, 14 Jun 2026 00:00:00 GMT",
      contentHash: "old-hash",
      outLinksJson: JSON.stringify([]),
      lastChangedAt: 50,
      pageCheckIntervalS: 604_800,
      pageChangeStreak: 0,
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
      renderFallback: {
        browser: {} as NonNullable<Environment["BROWSER"]>,
        claimRender,
        releaseRender,
      },
    });

    expect(renderWithBrowser).not.toHaveBeenCalled();
    expect(releaseRender).not.toHaveBeenCalled();
    expect(links).toEqual([]);
    expect(updates).toContainEqual(
      expect.objectContaining({
        title: "App",
        contentHash: "static-hash",
        outLinksJson: JSON.stringify([]),
      }),
    );
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
