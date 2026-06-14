import { sites } from "@profound-takehome/db";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../bindings";
import { createTestEnv, FakeDb } from "../test-helpers";
import { sitesRouter } from "./sites";

vi.mock("drizzle-orm/d1", () => ({
  drizzle: vi.fn((db) => db),
}));

function appForSites() {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/api/sites", sitesRouter);
  return app;
}

function jsonPost(url: string) {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  };
}

function monitoringPatch(enabled: boolean) {
  return {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled }),
  };
}

describe("sitesRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("rejects an invalid URL", async () => {
    const response = await appForSites().request(
      "/api/sites",
      jsonPost("not a url"),
      createTestEnv(new FakeDb()),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_url" });
  });

  it("rejects a private URL", async () => {
    const response = await appForSites().request(
      "/api/sites",
      jsonPost("http://127.0.0.1"),
      createTestEnv(new FakeDb()),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "unresolvable_url" });
  });

  it("creates a new site, initial crawl run, and discover message", async () => {
    vi.setSystemTime(new Date("2026-06-14T12:00:00Z"));
    const db = new FakeDb();
    db.queueSelect(sites, undefined);
    const env = createTestEnv(db);

    const response = await appForSites().request(
      "/api/sites",
      jsonPost("https://Example.com/docs"),
      env,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { siteId: string; runId: string };
    expect(body.siteId).toHaveLength(12);
    expect(body.runId).toHaveLength(12);
    expect(db.inserts).toHaveLength(2);
    expect(db.inserts[0]).toMatchObject({
      table: "sites",
      values: {
        id: body.siteId,
        domain: "https://example.com",
        monitoring: 0,
        checkIntervalS: 86400,
        changeStreak: 0,
        createdAt: 1781438400,
      },
    });
    expect(db.inserts[1]).toMatchObject({
      table: "crawlRuns",
      values: {
        id: body.runId,
        siteId: body.siteId,
        trigger: "initial",
        status: "queued",
        startedAt: 1781438400,
      },
    });
    expect(env.CRAWL_QUEUE.send).toHaveBeenCalledWith({
      type: "discover",
      runId: body.runId,
      siteId: body.siteId,
      url: "https://example.com",
    });
  });

  it("reuses an existing site and creates a manual crawl run", async () => {
    vi.setSystemTime(new Date("2026-06-14T12:00:00Z"));
    const existing = {
      id: "site_existing",
      domain: "https://example.com",
      monitoring: 0,
      checkIntervalS: 86400,
      changeStreak: 0,
      createdAt: 1,
    };
    const db = new FakeDb();
    db.queueSelect(sites, existing);
    const env = createTestEnv(db);

    const response = await appForSites().request(
      "/api/sites",
      jsonPost("https://example.com/pricing"),
      env,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { siteId: string; runId: string };
    expect(body.siteId).toBe(existing.id);
    expect(db.inserts).toHaveLength(1);
    expect(db.inserts[0]).toMatchObject({
      table: "crawlRuns",
      values: {
        id: body.runId,
        siteId: existing.id,
        trigger: "manual",
        status: "queued",
        startedAt: 1781438400,
      },
    });
    expect(env.CRAWL_QUEUE.send).toHaveBeenCalledWith({
      type: "discover",
      runId: body.runId,
      siteId: existing.id,
      url: "https://example.com",
    });
  });

  it("enables monitoring from the site's current interval", async () => {
    vi.setSystemTime(new Date("2026-06-14T12:00:00Z"));
    const site = {
      id: "site_1",
      domain: "https://example.com",
      monitoring: 0,
      checkIntervalS: 3600,
      nextCheckAt: null,
      changeStreak: 0,
      createdAt: 1,
    };
    const updated = { ...site, monitoring: 1, nextCheckAt: 1781442000 };
    const db = new FakeDb();
    db.queueSelect(sites, site);
    db.queueSelect(sites, updated);

    const response = await appForSites().request(
      "/api/sites/site_1/monitoring",
      monitoringPatch(true),
      createTestEnv(db),
    );

    expect(response.status).toBe(200);
    expect(db.updates).toEqual([
      { table: "sites", values: { monitoring: 1, nextCheckAt: 1781442000 } },
    ]);
    expect(await response.json()).toEqual({ site: updated });
  });

  it("disables monitoring and clears nextCheckAt", async () => {
    vi.setSystemTime(new Date("2026-06-14T12:00:00Z"));
    const site = {
      id: "site_1",
      domain: "https://example.com",
      monitoring: 1,
      checkIntervalS: 3600,
      nextCheckAt: 1781442000,
      changeStreak: 0,
      createdAt: 1,
    };
    const updated = { ...site, monitoring: 0, nextCheckAt: null };
    const db = new FakeDb();
    db.queueSelect(sites, site);
    db.queueSelect(sites, updated);

    const response = await appForSites().request(
      "/api/sites/site_1/monitoring",
      monitoringPatch(false),
      createTestEnv(db),
    );

    expect(response.status).toBe(200);
    expect(db.updates).toEqual([
      { table: "sites", values: { monitoring: 0, nextCheckAt: null } },
    ]);
    expect(await response.json()).toEqual({ site: updated });
  });

  it("returns 404 when toggling monitoring for an unknown site", async () => {
    const db = new FakeDb();
    db.queueSelect(sites, undefined);

    const response = await appForSites().request(
      "/api/sites/missing/monitoring",
      monitoringPatch(true),
      createTestEnv(db),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(db.updates).toEqual([]);
    expect(db.inserts.filter((insert) => insert.table === "crawlRuns")).toHaveLength(0);
  });
});
