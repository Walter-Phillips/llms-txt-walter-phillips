import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOCK_TIMELINE, mockClient, resetMockState } from "./mock-api";

const METHODS = [
  "createSite",
  "getSite",
  "getJob",
  "getVersions",
  "getPages",
  "getDiff",
  "setMonitoring",
  "getLlmsTxt",
] as const;

describe("mock API simulation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T12:00:00Z"));
    resetMockState();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("walks a run from queued through crawling to done", async () => {
    const { siteId, runId } = await mockClient.createSite("https://acme.dev");
    expect(siteId).toBe("site_acme-dev");

    let job = await mockClient.getJob(runId);
    expect(job.run.status).toBe("queued");
    expect(job.live?.phase).toBe("discovering");

    vi.setSystemTime(Date.now() + (MOCK_TIMELINE.queuedUntil + MOCK_TIMELINE.crawlingUntil) / 2);
    job = await mockClient.getJob(runId);
    const crawlingLive = job.live;
    expect(job.run.status).toBe("crawling");
    expect(crawlingLive?.discoveryMethod).toBe("sitemap");
    if (crawlingLive === undefined) {
      throw new Error("Expected crawling job to include live progress.");
    }
    expect(crawlingLive.pagesCrawled).toBeGreaterThan(0);
    expect(crawlingLive.pagesCrawled).toBeLessThan(MOCK_TIMELINE.pagesFound);

    vi.setSystemTime(Date.now() + MOCK_TIMELINE.generatingUntil);
    job = await mockClient.getJob(runId);
    expect(job.run.status).toBe("done");
    expect(job.run.pagesCrawled).toBe(MOCK_TIMELINE.pagesFound);

    // Completion publishes a new version on top of the two seeded ones.
    const { versions } = await mockClient.getVersions(siteId);
    expect(versions.map((v) => v.version)).toEqual([3, 2, 1]);

    const site = await mockClient.getSite(siteId);
    expect(site.site.domain).toBe("https://acme.dev");

    const file = await mockClient.getLlmsTxt("https://acme.dev");
    expect(file).toContain("# Acme");
    expect(file).toContain("## Docs");
  });

  it("fails runs for hostnames containing 'error'", async () => {
    const { runId } = await mockClient.createSite("https://error.example.com");
    vi.setSystemTime(Date.now() + MOCK_TIMELINE.errorAt + 1);
    const job = await mockClient.getJob(runId);
    expect(job.run.status).toBe("error");
    expect(job.run.error).toMatch(/fetch_failed/);
  });

  it("produces a unified diff between any two versions", async () => {
    await mockClient.createSite("https://acme.dev");
    const diff = await mockClient.getDiff("site_acme-dev", 1, 2);
    expect(diff.diff).toContain("--- llms.txt v1");
    expect(diff.diff).toContain("+++ llms.txt v2");
    expect(diff.diff).toContain("+- [Authentication](https://acme.dev/docs/auth)");
  });

  it("toggles monitoring and schedules the next check", async () => {
    const { siteId } = await mockClient.createSite("https://acme.dev");
    const initial = await mockClient.getSite(siteId);
    expect(initial.site.monitoring).toBe(1);
    expect(initial.site.nextCheckAt).toBe(Date.now() + initial.site.checkIntervalS * 1000);

    const off = await mockClient.setMonitoring(siteId, false);
    expect(off.site.monitoring).toBe(0);
    expect(off.site.nextCheckAt).toBeNull();

    const on = await mockClient.setMonitoring(siteId, true);
    expect(on.site.monitoring).toBe(1);
    expect(on.site.nextCheckAt).toBe(Date.now() + on.site.checkIntervalS * 1000);
  });

  it("turns monitoring back on when creating a crawl for an existing paused site", async () => {
    const { siteId } = await mockClient.createSite("https://acme.dev");
    await mockClient.setMonitoring(siteId, false);

    await mockClient.createSite("https://acme.dev/docs");

    const site = await mockClient.getSite(siteId);
    expect(site.site.monitoring).toBe(1);
    expect(site.site.nextCheckAt).toBe(Date.now() + site.site.checkIntervalS * 1000);
  });

  it("rejects unparseable URLs with a 400", async () => {
    await expect(mockClient.createSite("not a url")).rejects.toMatchObject({ status: 400 });
  });

  it("requires the same full URL shape as the Worker", async () => {
    await expect(mockClient.createSite("acme.dev")).rejects.toMatchObject({ status: 400 });
  });

  it("exposes exactly the LlmsApi method set", () => {
    expect(Object.keys(mockClient).sort()).toEqual([...METHODS].sort());
    for (const method of METHODS) {
      expect(typeof mockClient[method]).toBe("function");
    }
  });
});
