import { describe, expect, it } from "vitest";
import { assessExtractionQuality, renderedExtractionIsBetter } from "./extraction-quality";
import type { ExtractedPage } from "./extract";

function page(overrides: Partial<ExtractedPage> = {}): ExtractedPage {
  return {
    title: "Example",
    description: "Example description",
    h1: "Example",
    snippet:
      "This is a useful paragraph with enough content to describe the page for the generated llms.txt inventory.",
    contentHash: "hash",
    links: ["/docs", "/blog", "/pricing"],
    ...overrides,
  };
}

describe("assessExtractionQuality", () => {
  it("keeps useful static pages on the static path", () => {
    const quality = assessExtractionQuality(page(), {
      url: "https://example.com/",
      depth: 0,
      followLinks: true,
    });

    expect(quality.shouldRenderFallback).toBe(false);
    expect(quality.crawlableLinkCount).toBe(3);
    expect(quality.reasons).toEqual([]);
  });

  it("requests browser fallback for thin app-shell-like pages", () => {
    const quality = assessExtractionQuality(
      page({
        title: "App",
        description: null,
        h1: "Loading",
        snippet: null,
        links: [],
      }),
      {
        url: "https://example.com/",
        depth: 0,
        followLinks: true,
      },
    );

    expect(quality.shouldRenderFallback).toBe(true);
    expect(quality.reasons).toEqual(["thin_content", "generic_heading", "few_static_links"]);
  });
});

describe("renderedExtractionIsBetter", () => {
  it("accepts rendered output when it adds useful content or links", () => {
    const staticPage = page({ description: null, snippet: null, links: [] });
    const renderedPage = page({ links: ["/docs", "/blog", "/projects", "/writing"] });

    expect(
      renderedExtractionIsBetter(staticPage, renderedPage, {
        url: "https://example.com/",
        depth: 0,
        followLinks: true,
      }),
    ).toBe(true);
  });
});
