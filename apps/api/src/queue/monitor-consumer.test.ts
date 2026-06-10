import { describe, expect, it } from "vitest";
import { byDepth, parseSitemapXml } from "./monitor-consumer";

describe("parseSitemapXml", () => {
  it("extracts loc and lastmod pairs", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/</loc>
    <lastmod>2026-05-01</lastmod>
  </url>
  <url>
    <loc> https://example.com/docs </loc>
  </url>
</urlset>`;
    expect(parseSitemapXml(xml)).toEqual([
      { url: "https://example.com/", lastmod: "2026-05-01" },
      { url: "https://example.com/docs", lastmod: null },
    ]);
  });

  it("decodes xml entities in urls", () => {
    const xml = `<urlset><url><loc>https://example.com/a?x=1&amp;y=2</loc></url></urlset>`;
    expect(parseSitemapXml(xml)).toEqual([
      { url: "https://example.com/a?x=1&y=2", lastmod: null },
    ]);
  });

  it("returns empty for non-sitemap content", () => {
    expect(parseSitemapXml("<html><body>404</body></html>")).toEqual([]);
  });
});

describe("byDepth", () => {
  it("orders urls shallowest first, stable on ties", () => {
    expect(
      byDepth([
        "https://example.com/a/b/c",
        "https://example.com/docs",
        "https://example.com/",
        "https://example.com/about",
        "https://example.com/blog/post",
      ]),
    ).toEqual([
      "https://example.com/",
      "https://example.com/about",
      "https://example.com/docs",
      "https://example.com/blog/post",
      "https://example.com/a/b/c",
    ]);
  });

  it("pushes unparseable urls last", () => {
    expect(byDepth(["not a url", "https://example.com/"])).toEqual([
      "https://example.com/",
      "not a url",
    ]);
  });
});
