import { crawlRuns, fileVersions, pages, sites } from "@profound-takehome/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Inventory } from "./heuristics";
import { refine } from "./llm";
import { generate } from "./index";
import { createTestEnv, FakeDb } from "../test-helpers";

vi.mock("drizzle-orm/d1", () => ({
  drizzle: vi.fn((db) => db),
}));

vi.mock("./llm", () => ({
  refine: vi.fn(),
}));

const site = {
  id: "site_1",
  domain: "https://example.com",
  monitoring: 0,
  checkIntervalS: 86400,
  nextCheckAt: null,
  changeStreak: 0,
  createdAt: 1,
};

const run = {
  id: "run_1",
  siteId: site.id,
  trigger: "initial",
  status: "generating",
  pagesFound: 2,
  pagesCrawled: 2,
  pagesChanged: 0,
  startedAt: 100,
  finishedAt: null,
};

const pageRows = [
  {
    id: "page_home",
    siteId: site.id,
    url: "https://example.com/",
    title: "Example | Site",
    description: "Homepage summary.",
    h1: "Example",
    snippet: null,
    sectionHint: null,
    status: "active",
    lastSeenAt: 120,
  },
  {
    id: "page_docs",
    siteId: site.id,
    url: "https://example.com/docs",
    title: "Docs",
    description: "Documentation overview.",
    h1: "Docs",
    snippet: null,
    sectionHint: null,
    status: "active",
    lastSeenAt: 120,
  },
];

function queueFreshGeneration(db: FakeDb, latest: { version: number } | undefined = undefined) {
  db.queueSelect(sites, site);
  db.queueSelect(fileVersions, undefined);
  db.queueSelect(crawlRuns, run);
  db.queueSelect(pages, pageRows);
  db.queueSelect(fileVersions, undefined);
  db.queueSelect(fileVersions, latest);
}

function createEnvWithPut(db: FakeDb) {
  const put = vi.fn(async (_key: string, _content: string, _options?: unknown) => undefined);
  const env = createTestEnv(db, { FILES: { put } as unknown as R2Bucket });
  return { env, put };
}

describe("generate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an existing version for the run without publishing again", async () => {
    const db = new FakeDb();
    db.queueSelect(sites, site);
    db.queueSelect(fileVersions, { version: 2, r2Key: "site_1/v2.txt" });
    const { env, put } = createEnvWithPut(db);

    const result = await generate(env, site.id, run.id);

    expect(result).toEqual({ version: 2, r2Key: "site_1/v2.txt" });
    expect(put).not.toHaveBeenCalled();
    expect(db.updates).toEqual([
      {
        table: "crawlRuns",
        values: { status: "done", finishedAt: expect.any(Number) },
      },
    ]);
  });

  it("publishes Pass 1 content when LLM refinement throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(refine).mockRejectedValue(new Error("llm down"));
    const db = new FakeDb();
    queueFreshGeneration(db);
    const { env, put } = createEnvWithPut(db);

    const result = await generate(env, site.id, run.id);

    expect(result).toEqual({ version: 1, r2Key: "site_1/v1.txt" });
    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith(
      "site_1/v1.txt",
      expect.stringContaining("## Documentation"),
      { httpMetadata: { contentType: "text/plain; charset=utf-8" } },
    );
    expect(db.inserts).toEqual([
      {
        table: "fileVersions",
        values: expect.objectContaining({
          siteId: site.id,
          runId: run.id,
          version: 1,
          r2Key: "site_1/v1.txt",
          changeSummary: "initial generation",
          generatedBy: "heuristic",
        }),
      },
    ]);
  });

  it("publishes Pass 1 content when LLM refinement returns null", async () => {
    vi.mocked(refine).mockResolvedValue(null);
    const db = new FakeDb();
    queueFreshGeneration(db);
    const { env, put } = createEnvWithPut(db);

    const result = await generate(env, site.id, run.id);

    expect(result).toEqual({ version: 1, r2Key: "site_1/v1.txt" });
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]?.[1]).toContain("> Homepage summary.");
    expect(db.inserts[0]).toMatchObject({
      table: "fileVersions",
      values: {
        siteId: site.id,
        runId: run.id,
        version: 1,
        r2Key: "site_1/v1.txt",
        generatedBy: "heuristic",
      },
    });
  });

  it("publishes refined content when the refined inventory validates", async () => {
    const refinedInventory: Inventory = {
      siteName: "Refined Example",
      origin: "https://example.com",
      homepageSnippet: "Refined homepage.",
      sections: [
        {
          name: "For Developers",
          pages: [
            {
              url: "https://example.com/docs",
              title: "Developer Docs",
              description: "Refined developer documentation.",
              h1: "Docs",
              sectionHint: "For Developers",
            },
          ],
        },
      ],
      optional: [],
    };
    vi.mocked(refine).mockResolvedValue({
      inventory: refinedInventory,
      summary: "Refined summary.",
    });
    const db = new FakeDb();
    queueFreshGeneration(db);
    const { env, put } = createEnvWithPut(db);

    await generate(env, site.id, run.id);

    expect(put).toHaveBeenCalledTimes(1);
    const content = put.mock.calls[0]?.[1] as string;
    expect(content).toContain("# Refined Example");
    expect(content).toContain("> Refined summary.");
    expect(content).toContain("## For Developers");
    expect(content).not.toContain("## Documentation");
    expect(db.inserts[0]).toMatchObject({
      table: "fileVersions",
      values: { generatedBy: "llm-refined" },
    });
  });

  it("increments from the latest existing version for the site", async () => {
    vi.mocked(refine).mockResolvedValue(null);
    const db = new FakeDb();
    queueFreshGeneration(db, { version: 2 });
    const { env, put } = createEnvWithPut(db);

    const result = await generate(env, site.id, run.id);

    expect(result).toEqual({ version: 3, r2Key: "site_1/v3.txt" });
    expect(put).toHaveBeenCalledWith(
      "site_1/v3.txt",
      expect.any(String),
      { httpMetadata: { contentType: "text/plain; charset=utf-8" } },
    );
    expect(db.inserts[0]).toMatchObject({
      table: "fileVersions",
      values: { siteId: site.id, runId: run.id, version: 3, r2Key: "site_1/v3.txt" },
    });
  });
});
