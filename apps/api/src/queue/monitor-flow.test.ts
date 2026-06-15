import { pages, sites } from "@profound-takehome/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Environment, MonitorMessage } from "../bindings";
import { discoverSitemapEntries } from "../crawler/sitemap";
import { fetchRobots } from "../crawler/robots";
import { enqueueDueMonitorJobs } from "../monitor/schedule";
import { createTestEnvironment, FakeDatabase } from "../test-helpers";
import { handleMonitorBatch } from "./monitor-consumer";

vi.mock("drizzle-orm/d1", () => ({
  drizzle: vi.fn((db: D1Database): D1Database => db),
}));

vi.mock("nanoid", () => ({
  nanoid: () => "monitor_run",
}));

vi.mock("../crawler/robots", () => ({
  fetchRobots: vi.fn(),
}));

vi.mock("../crawler/sitemap", () => ({
  discoverSitemapEntries: vi.fn(),
}));

const NOW = new Date("2026-06-14T12:00:00Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
const HOUR = 3600;
const DAY = 24 * HOUR;

const site = {
  id: "site_1",
  domain: "https://example.com",
  monitoring: 1,
  checkIntervalS: DAY,
  nextCheckAt: NOW_SECONDS,
  changeStreak: 0,
  createdAt: 1,
};

function batchFromMessages(messages: MonitorMessage[]): {
  batch: MessageBatch<MonitorMessage>;
  acks: ReturnType<typeof vi.fn>[];
  retries: ReturnType<typeof vi.fn>[];
} {
  const acks: ReturnType<typeof vi.fn>[] = [];
  const retries: ReturnType<typeof vi.fn>[] = [];
  const queued = messages.map((body) => {
    const ack = vi.fn();
    const retry = vi.fn();
    acks.push(ack);
    retries.push(retry);
    return { body, ack, retry };
  });

  return {
    batch: { queue: "monitor-queue", messages: queued } as unknown as MessageBatch<MonitorMessage>,
    acks,
    retries,
  };
}

function monitorEnvironment(db: FakeDatabase): {
  env: Environment;
  sendBatch: ReturnType<typeof vi.fn>;
  sendCrawl: ReturnType<typeof vi.fn>;
} {
  const sendBatch = vi.fn(() => Promise.resolve(undefined));
  const sendCrawl = vi.fn(() => Promise.resolve(undefined));
  return {
    env: createTestEnvironment(db, {
      CRAWL_QUEUE: { send: sendCrawl } as unknown as Environment["CRAWL_QUEUE"],
      MONITOR_QUEUE: { sendBatch } as unknown as Environment["MONITOR_QUEUE"],
    }),
    sendBatch,
    sendCrawl,
  };
}

describe("scheduled monitor update flow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    vi.mocked(fetchRobots).mockResolvedValue({
      disallow: [],
      crawlDelayMs: 500,
      sitemaps: ["https://example.com/sitemap.xml"],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("enqueues due sites, detects sitemap changes, queues a monitor crawl, and advances cadence", async () => {
    vi.mocked(discoverSitemapEntries).mockResolvedValue({
      entries: [
        { url: "https://example.com/", lastmod: "2026-01-01" },
        { url: "https://example.com/docs", lastmod: "2026-06-14" },
      ],
      isNews: false,
      found: ["https://example.com/sitemap.xml"],
    });

    const db = new FakeDatabase();
    db.queueSelect(sites, [{ id: site.id }]);
    db.queueSelect(sites, site);
    db.queueSelect(pages, [
      {
        url: "https://example.com/",
        etag: '"home"',
        lastModified: "Thu, 01 Jan 2026 00:00:00 GMT",
        sitemapLastmod: "2026-01-01",
        contentHash: "home-hash",
        lastCheckedAt: NOW_SECONDS,
        pageCheckIntervalS: 7 * DAY,
        pageChangeStreak: 0,
      },
      {
        url: "https://example.com/old",
        etag: '"old"',
        lastModified: "Thu, 01 Jan 2026 00:00:00 GMT",
        sitemapLastmod: "2026-01-01",
        contentHash: "old-hash",
        lastCheckedAt: NOW_SECONDS,
        pageCheckIntervalS: 7 * DAY,
        pageChangeStreak: 0,
      },
    ]);
    const { env, sendBatch, sendCrawl } = monitorEnvironment(db);

    await enqueueDueMonitorJobs(env);

    expect(sendBatch).toHaveBeenCalledWith([{ body: { type: "check", siteId: site.id } }]);

    const sentMessages = sendBatch.mock.calls[0]?.[0] as { body: MonitorMessage }[];
    const { batch, acks, retries } = batchFromMessages(sentMessages.map((message) => message.body));
    await handleMonitorBatch(batch, env, {} as ExecutionContext);

    expect(fetchRobots).toHaveBeenCalledWith(site.domain);
    expect(discoverSitemapEntries).toHaveBeenCalledWith(
      site.domain,
      ["https://example.com/sitemap.xml"],
      { maxUrls: 1_000 },
    );
    expect(db.updates).toEqual([
      { table: "pages", values: { status: "removed" } },
      {
        table: "sites",
        values: {
          checkIntervalS: 12 * HOUR,
          nextCheckAt: NOW_SECONDS + 12 * HOUR,
          changeStreak: 1,
        },
      },
    ]);
    expect(db.inserts).toEqual([
      {
        table: "crawlRuns",
        values: {
          id: "monitor_run",
          siteId: site.id,
          trigger: "monitor",
          status: "queued",
          pagesChanged: 2,
          changeSummary: "1 page added, 1 page removed",
          startedAt: NOW_SECONDS,
        },
      },
    ]);
    expect(sendCrawl).toHaveBeenCalledWith({
      type: "discover",
      runId: "monitor_run",
      siteId: site.id,
      url: site.domain,
    });
    expect(acks[0]).toHaveBeenCalledOnce();
    expect(retries[0]).not.toHaveBeenCalled();
  });

  it("backs off cadence without queueing a crawl when the site is unchanged", async () => {
    vi.mocked(discoverSitemapEntries).mockResolvedValue({
      entries: [{ url: "https://example.com/", lastmod: "2026-01-01" }],
      isNews: false,
      found: ["https://example.com/sitemap.xml"],
    });

    const db = new FakeDatabase();
    db.queueSelect(sites, site);
    db.queueSelect(pages, [
      {
        url: "https://example.com/",
        etag: '"home"',
        lastModified: "Thu, 01 Jan 2026 00:00:00 GMT",
        sitemapLastmod: "2026-01-01",
        contentHash: "home-hash",
        lastCheckedAt: NOW_SECONDS,
        pageCheckIntervalS: 7 * DAY,
        pageChangeStreak: 0,
      },
    ]);
    const { env, sendCrawl } = monitorEnvironment(db);
    const { batch, acks, retries } = batchFromMessages([{ type: "check", siteId: site.id }]);

    await handleMonitorBatch(batch, env, {} as ExecutionContext);

    expect(db.inserts).toEqual([]);
    expect(sendCrawl).not.toHaveBeenCalled();
    expect(db.updates).toEqual([
      {
        table: "sites",
        values: {
          checkIntervalS: 36 * HOUR,
          nextCheckAt: NOW_SECONDS + 36 * HOUR,
          changeStreak: -1,
        },
      },
    ]);
    expect(acks[0]).toHaveBeenCalledOnce();
    expect(retries[0]).not.toHaveBeenCalled();
  });

  it("does not enqueue monitor jobs when no sites are due", async () => {
    const db = new FakeDatabase();
    db.queueSelect(sites, []);
    const { env, sendBatch } = monitorEnvironment(db);

    await enqueueDueMonitorJobs(env);

    expect(sendBatch).not.toHaveBeenCalled();
  });

  it("retries the monitor message when processing fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(fetchRobots).mockRejectedValue(new Error("robots unavailable"));
    const db = new FakeDatabase();
    db.queueSelect(sites, site);
    db.queueSelect(pages, []);
    const { env } = monitorEnvironment(db);
    const { batch, acks, retries } = batchFromMessages([{ type: "check", siteId: site.id }]);

    await handleMonitorBatch(batch, env, {} as ExecutionContext);

    expect(acks[0]).not.toHaveBeenCalled();
    expect(retries[0]).toHaveBeenCalledOnce();
  });
});
