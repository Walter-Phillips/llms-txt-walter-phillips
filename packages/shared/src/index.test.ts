import { describe, expect, it } from "vitest";
import { fileVersionSchema, healthResponseSchema, runSchema } from "./index";

describe("healthResponseSchema", () => {
  it("parses an ok response", () => {
    expect(healthResponseSchema.parse({ status: "ok" })).toEqual({ status: "ok" });
  });
});

describe("runSchema", () => {
  it("accepts the optional crawl cap reason", () => {
    expect(
      runSchema.parse({
        id: "run_1",
        siteId: "site_1",
        trigger: "initial",
        status: "done",
        pagesFound: 1000,
        pagesCrawled: 1000,
        pagesChanged: 0,
        discoveryMethod: "sitemap",
        capReason: "max_pages",
        error: null,
        startedAt: 1,
        finishedAt: 2,
      }).capReason,
    ).toBe("max_pages");
  });
});

describe("fileVersionSchema", () => {
  it("accepts the optional generation pass outcome", () => {
    expect(
      fileVersionSchema.parse({
        id: "version_1",
        siteId: "site_1",
        runId: "run_1",
        version: 1,
        r2Key: "site_1/v1.txt",
        changeSummary: null,
        generatedBy: "llm-refined",
        createdAt: 1,
      }).generatedBy,
    ).toBe("llm-refined");
  });
});
