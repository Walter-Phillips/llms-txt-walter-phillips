import { describe, expect, it } from "vitest";
import {
  EMPTY_CHANGESET,
  buildChangeSet,
  classifyConditionalGet,
  diffSitemap,
  hashChanged,
  isRegenerationWorthy,
} from "./detect";

describe("diffSitemap", () => {
  const stored = [
    { url: "https://example.com/", sitemapLastmod: "2026-01-01" },
    { url: "https://example.com/docs", sitemapLastmod: "2026-02-01" },
    { url: "https://example.com/old", sitemapLastmod: null },
  ];

  it("detects added, removed, and lastmod-changed urls", () => {
    const current = [
      { url: "https://example.com/", lastmod: "2026-01-01" },
      { url: "https://example.com/docs", lastmod: "2026-03-15" },
      { url: "https://example.com/new", lastmod: "2026-03-01" },
    ];
    expect(diffSitemap(stored, current)).toEqual({
      added: ["https://example.com/new"],
      removed: ["https://example.com/old"],
      lastmodChanged: ["https://example.com/docs"],
    });
  });

  it("ignores lastmod when either side lacks one", () => {
    const current = [
      { url: "https://example.com/", lastmod: null },
      { url: "https://example.com/docs", lastmod: "2026-02-01" },
      { url: "https://example.com/old", lastmod: "2026-06-01" }, // stored has null
    ];
    expect(diffSitemap(stored, current)).toEqual({ added: [], removed: [], lastmodChanged: [] });
  });

  it("returns everything added for a brand-new site", () => {
    const diff = diffSitemap([], [{ url: "https://example.com/a", lastmod: null }]);
    expect(diff.added).toEqual(["https://example.com/a"]);
    expect(diff.removed).toEqual([]);
  });
});

describe("classifyConditionalGet", () => {
  const stored = { etag: '"abc"', lastModified: "Mon, 01 Jan 2026 00:00:00 GMT" };

  it("treats 304 as unchanged", () => {
    expect(
      classifyConditionalGet({ status: 304, etag: null, lastModified: null }, stored),
    ).toBe("unchanged");
  });

  it("treats 404/410 as removed", () => {
    expect(
      classifyConditionalGet({ status: 404, etag: null, lastModified: null }, stored),
    ).toBe("removed");
    expect(
      classifyConditionalGet({ status: 410, etag: null, lastModified: null }, stored),
    ).toBe("removed");
  });

  it("treats 5xx and other 4xx as transient errors", () => {
    expect(
      classifyConditionalGet({ status: 503, etag: null, lastModified: null }, stored),
    ).toBe("error");
    expect(
      classifyConditionalGet({ status: 403, etag: null, lastModified: null }, stored),
    ).toBe("error");
  });

  it("cross-checks etag on a 200 from validator-ignoring servers", () => {
    expect(
      classifyConditionalGet({ status: 200, etag: '"abc"', lastModified: null }, stored),
    ).toBe("unchanged");
    expect(
      classifyConditionalGet({ status: 200, etag: '"def"', lastModified: null }, stored),
    ).toBe("modified");
  });

  it("falls back to last-modified when no etag is stored", () => {
    const noEtag = { etag: null, lastModified: "Mon, 01 Jan 2026 00:00:00 GMT" };
    expect(
      classifyConditionalGet(
        { status: 200, etag: null, lastModified: "Mon, 01 Jan 2026 00:00:00 GMT" },
        noEtag,
      ),
    ).toBe("unchanged");
    expect(
      classifyConditionalGet(
        { status: 200, etag: null, lastModified: "Tue, 02 Jan 2026 00:00:00 GMT" },
        noEtag,
      ),
    ).toBe("modified");
  });

  it("treats a bare 200 with no validators anywhere as modified", () => {
    expect(
      classifyConditionalGet(
        { status: 200, etag: null, lastModified: null },
        { etag: null, lastModified: null },
      ),
    ).toBe("modified");
  });
});

describe("hashChanged", () => {
  it("only asserts change when both hashes are known", () => {
    expect(hashChanged("a", "b")).toBe(true);
    expect(hashChanged("a", "a")).toBe(false);
    expect(hashChanged(null, "b")).toBe(false);
    expect(hashChanged("a", null)).toBe(false);
  });
});

describe("buildChangeSet layering", () => {
  it("merges all three layers with deduping", () => {
    const c = buildChangeSet({
      sitemap: { added: ["/new"], removed: ["/gone"], lastmodChanged: ["/docs"] },
      conditional: [
        { url: "/docs", outcome: "modified" },
        { url: "/about", outcome: "removed" },
        { url: "/flaky", outcome: "error" },
        { url: "/same", outcome: "unchanged" },
      ],
      hashes: [{ url: "/pricing", storedHash: "h1", currentHash: "h2" }],
    });
    expect(c).toEqual({
      added: ["/new"],
      removed: ["/about", "/gone"],
      modified: ["/docs", "/pricing"],
    });
  });

  it("drops errors and unchanged outcomes entirely", () => {
    const c = buildChangeSet({
      conditional: [
        { url: "/a", outcome: "error" },
        { url: "/b", outcome: "unchanged" },
      ],
    });
    expect(c).toEqual(EMPTY_CHANGESET);
  });

  it("added wins over removed/modified for the same url", () => {
    const c = buildChangeSet({
      sitemap: { added: ["/x"], removed: ["/x"], lastmodChanged: [] },
      conditional: [{ url: "/x", outcome: "modified" }],
    });
    expect(c).toEqual({ added: ["/x"], removed: [], modified: [] });
  });

  it("removed wins over modified for the same url", () => {
    const c = buildChangeSet({
      sitemap: { added: [], removed: ["/y"], lastmodChanged: [] },
      conditional: [{ url: "/y", outcome: "modified" }],
    });
    expect(c).toEqual({ added: [], removed: ["/y"], modified: [] });
  });
});

describe("isRegenerationWorthy", () => {
  it("requires at least one structural or metadata change", () => {
    expect(isRegenerationWorthy(EMPTY_CHANGESET)).toBe(false);
    expect(isRegenerationWorthy({ added: ["/a"], removed: [], modified: [] })).toBe(true);
    expect(isRegenerationWorthy({ added: [], removed: ["/a"], modified: [] })).toBe(true);
    expect(isRegenerationWorthy({ added: [], removed: [], modified: ["/a"] })).toBe(true);
  });
});
