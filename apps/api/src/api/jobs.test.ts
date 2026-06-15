import { crawlRuns } from "@profound-takehome/db";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Environment } from "../bindings";
import {
  createSiteCoordinator,
  createTestEnv as createTestEnvironment,
  FakeDb as FakeDatabase,
} from "../test-helpers";
import { jobsRouter } from "./jobs";

vi.mock("drizzle-orm/d1", () => ({
  drizzle: vi.fn((db: unknown): unknown => db),
}));

function appForJobs(): Hono<{ Bindings: Environment }> {
  const app = new Hono<{ Bindings: Environment }>();
  app.route("/api/jobs", jobsRouter);
  return app;
}

async function readJson<T>(response: Response): Promise<T> {
  const value: unknown = await response.json();
  return value as T;
}

describe("jobsRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 for an unknown run", async () => {
    const db = new FakeDatabase();
    db.queueSelect(crawlRuns, undefined);

    const response = await appForJobs().request(
      "/api/jobs/missing-run",
      {},
      createTestEnvironment(db),
    );

    expect(response.status).toBe(404);
    expect(await readJson(response)).toEqual({ error: "not_found" });
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
      finishedAt: 200,
    };
    const db = new FakeDatabase();
    db.queueSelect(crawlRuns, run);

    const response = await appForJobs().request(
      "/api/jobs/run_done",
      {},
      createTestEnvironment(db),
    );

    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({ run });
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
      finishedAt: null,
    };
    const live = { status: "crawling", queued: 2 };
    const db = new FakeDatabase();
    db.queueSelect(crawlRuns, run);
    const coordinator = createSiteCoordinator(live);

    const response = await appForJobs().request(
      "/api/jobs/run_active",
      {},
      createTestEnvironment(db, { SITE_COORDINATOR: coordinator.namespace }),
    );

    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({ run, live });
    expect(coordinator.fetch).toHaveBeenCalledWith("https://do/status");
  });
});
