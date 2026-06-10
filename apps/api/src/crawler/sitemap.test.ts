import { describe, expect, it } from "vitest";
import { parseSitemapXml, prioritizeShallow } from "./sitemap";

const URLSET = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc><lastmod>2026-01-01</lastmod></url>
  <url><loc>https://example.com/docs/intro</loc></url>
  <url><loc>https://example.com/a&amp;b</loc><lastmod>2026-02-02</lastmod></url>
</urlset>`;

const INDEX = `<?xml version="1.0"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/sitemap-1.xml</loc></sitemap>
  <sitemap><loc>https://example.com/sitemap-2.xml</loc></sitemap>
</sitemapindex>`;

describe("parseSitemapXml", () => {
  it("parses urlset entries with lastmod", () => {
    const parsed = parseSitemapXml(URLSET);
    expect(parsed.kind).toBe("urlset");
    if (parsed.kind !== "urlset") return;
    expect(parsed.entries).toEqual([
      { url: "https://example.com/", lastmod: "2026-01-01" },
      { url: "https://example.com/docs/intro" },
      { url: "https://example.com/a&b", lastmod: "2026-02-02" },
    ]);
    expect(parsed.isNews).toBe(false);
  });

  it("recognizes sitemap index files", () => {
    const parsed = parseSitemapXml(INDEX);
    expect(parsed).toEqual({
      kind: "index",
      sitemaps: ["https://example.com/sitemap-1.xml", "https://example.com/sitemap-2.xml"],
    });
  });

  it("detects news sitemaps", () => {
    const news = URLSET.replace(
      "<urlset ",
      '<urlset xmlns:news="http://www.google.com/schemas/sitemap-news/0.9" ',
    );
    const parsed = parseSitemapXml(news);
    expect(parsed.kind === "urlset" && parsed.isNews).toBe(true);
  });
});

describe("prioritizeShallow", () => {
  it("sorts shallow paths first and caps the result", () => {
    const entries = [
      { url: "https://example.com/a/b/c" },
      { url: "https://example.com/" },
      { url: "https://example.com/a/b" },
      { url: "https://example.com/a" },
    ];
    expect(prioritizeShallow(entries, 3).map((e) => e.url)).toEqual([
      "https://example.com/",
      "https://example.com/a",
      "https://example.com/a/b",
    ]);
  });
});
