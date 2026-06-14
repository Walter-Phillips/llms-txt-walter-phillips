import { crawlRuns } from "@profound-takehome/db";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../bindings";
import { createSiteCoordinator, createTestEnv, FakeDb } from "../test-helpers";
import { jobsRouter } from "./jobs";

vi.mock("drizzle-orm/d1", () => ({
  drizzle: vi.fn((db) => db)
}));

function appForJobs() {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/api/jobs", jobsRouter);
  return app;
}

describe("jobsRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 for an unknown run", async () => {
    const db = new FakeDb();
    db.queueSelect(crawlRuns, undefined);

    const response = await appForJobs().request("/api/jobs/missing-run", {}, createTestEnv(db));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("returns a settled run without live state", async () => {
    const run = {
      id: "run_done",
      siteId: "site_1",
      trigger: "initial",
      status: "done",
      pagesFound: 2,
      pagesCrawled: 2,
      pagesChanged: 0,
      startedAt: 100,
      finishedAt: 200
    };
    const db = new FakeDb();
    db.queueSelect(crawlRuns, run);

    const response = await appForJobs().request("/api/jobs/run_done", {}, createTestEnv(db));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ run });
  });

  it("proxies live Durable Object state for an active run", async () => {
    const run = {
      id: "run_active",
      siteId: "site_1",
      trigger: "initial",
      status: "crawling",
      pagesFound: 3,
      pagesCrawled: 1,
      pagesChanged: 0,
      startedAt: 100,
      finishedAt: null
    };
    const live = { status: "crawling", queued: 2 };
    const db = new FakeDb();
    db.queueSelect(crawlRuns, run);
    const coordinator = createSiteCoordinator(live);

    const response = await appForJobs().request(
      "/api/jobs/run_active",
      {},
      createTestEnv(db, { SITE_COORDINATOR: coordinator.namespace })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ run, live });
    expect(coordinator.fetch).toHaveBeenCalledWith("https://do/status");
  });
});
