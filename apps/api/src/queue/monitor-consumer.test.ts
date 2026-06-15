import { describe, expect, it } from "vitest";
import { parseSitemapXml } from "../crawler/sitemap";
import { buildChangeSet } from "../monitor/detect";
import { selectMonitorCandidates, type ActivePage } from "./monitor-page-freshness";
import { byDepth, resolveCheck } from "./monitor-consumer";

function requireHash(resolved: ReturnType<typeof resolveCheck>): {
  url: string;
  storedHash: string | null;
  currentHash: string | null;
} {
  expect(resolved.hash).toBeDefined();
  if (!resolved.hash) throw new Error("expected hash result");
  return resolved.hash;
}

function sitemapEntries(xml: string): { url: string; lastmod: string | null }[] {
  const parsed = parseSitemapXml(xml);
  if (parsed.kind !== "urlset") return [];
  return parsed.entries.map((entry) => ({ url: entry.url, lastmod: entry.lastmod ?? null }));
}

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
    expect(sitemapEntries(xml)).toEqual([
      { url: "https://example.com/", lastmod: "2026-05-01" },
      { url: "https://example.com/docs", lastmod: null },
    ]);
  });

  it("decodes xml entities in urls", () => {
    const xml = `<urlset><url><loc>https://example.com/a?x=1&amp;y=2</loc></url></urlset>`;
    expect(sitemapEntries(xml)).toEqual([{ url: "https://example.com/a?x=1&y=2", lastmod: null }]);
  });

  it("returns empty for non-sitemap content", () => {
    expect(sitemapEntries("<html><body>404</body></html>")).toEqual([]);
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

describe("selectMonitorCandidates", () => {
  const DAY = 24 * 3600;
  const now = 10 * DAY;

  function active(url: string, fields: Partial<ActivePage> = {}): ActivePage {
    return {
      url,
      etag: null,
      lastModified: null,
      sitemapLastmod: null,
      contentHash: null,
      lastCheckedAt: null,
      lastChangedAt: null,
      pageCheckIntervalS: 7 * DAY,
      pageChangeStreak: 0,
      ...fields,
    };
  }

  it("checks sitemap lastmod candidates first, then fills with stale active pages", () => {
    const candidates = selectMonitorCandidates(
      [
        active("https://example.com/"),
        active("https://example.com/docs", { lastCheckedAt: 9 * DAY }),
        active("https://example.com/blog", { lastCheckedAt: 1 * DAY }),
      ],
      {
        added: [],
        removed: [],
        lastmodChanged: ["https://example.com/docs"],
      },
      3,
      now,
    );

    expect(candidates).toEqual([
      "https://example.com/docs",
      "https://example.com/",
      "https://example.com/blog",
    ]);
  });

  it("does not spend conditional budget on sitemap-removed pages", () => {
    const candidates = selectMonitorCandidates(
      [active("https://example.com/removed"), active("https://example.com/kept")],
      {
        added: [],
        removed: ["https://example.com/removed"],
        lastmodChanged: [],
      },
      5,
      now,
    );

    expect(candidates).toEqual(["https://example.com/kept"]);
  });

  it("uses oldest last checked time, then depth and URL for no-sitemap sampling", () => {
    const candidates = selectMonitorCandidates(
      [
        active("https://example.com/a/deep", { lastCheckedAt: 1 * DAY }),
        active("https://example.com/", { lastCheckedAt: 1 * DAY }),
        active("https://example.com/recent", { lastCheckedAt: 9 * DAY }),
      ],
      undefined,
      2,
      now,
    );

    expect(candidates).toEqual(["https://example.com/", "https://example.com/a/deep"]);
  });
});

describe("resolveCheck (hash vs conditional double-count)", () => {
  const url = "https://example.com/p";

  it("a validator-less 200 with an unchanged body is NOT modified", () => {
    // classifyConditionalGet would say "modified" with no usable validators,
    // but the equal content hash is authoritative → keep the url out entirely.
    const resolved = resolveCheck(url, {
      outcome: "modified",
      storedHash: "h1",
      currentHash: "h1",
    });
    expect(resolved.conditional).toEqual({ url, outcome: "unchanged" });
    expect(resolved.hash).toEqual({ url, storedHash: "h1", currentHash: "h1" });

    const changes = buildChangeSet({
      conditional: [resolved.conditional],
      hashes: [requireHash(resolved)],
    });
    expect(changes.modified).toEqual([]);
  });

  it("a validator-less 200 with a changed body IS modified (exactly once)", () => {
    const resolved = resolveCheck(url, {
      outcome: "modified",
      storedHash: "h1",
      currentHash: "h2",
    });
    expect(resolved.conditional).toEqual({ url, outcome: "unchanged" });

    const changes = buildChangeSet({
      conditional: [resolved.conditional],
      hashes: [requireHash(resolved)],
    });
    expect(changes.modified).toEqual([url]);
  });

  it("keeps removed/error outcomes even when a body hash was computed", () => {
    expect(
      resolveCheck(url, { outcome: "removed", storedHash: "h1", currentHash: "h2" }).conditional,
    ).toEqual({ url, outcome: "removed" });
  });

  it("passes conditional outcomes through untouched when no body was hashed", () => {
    const resolved = resolveCheck(url, { outcome: "modified", storedHash: "h1" });
    expect(resolved.conditional).toEqual({ url, outcome: "modified" });
    expect(resolved.hash).toBeUndefined();
  });
});
