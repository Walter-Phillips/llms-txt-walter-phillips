import { afterEach, describe, expect, it, vi } from "vitest";
import {
  discoverSitemapEntries,
  parseSitemapDocument,
  parseSitemapXml,
  prioritizeShallow
} from "./sitemap";

vi.mock("./fetcher", () => ({
  politeFetch: vi.fn(),
  readBodyText: vi.fn()
}));

import { politeFetch, readBodyText } from "./fetcher";

const mockPoliteFetch = vi.mocked(politeFetch);
const mockReadBodyText = vi.mocked(readBodyText);

/**
 * Drive the mocked fetcher from a map of URL -> XML body. URLs absent from the
 * map respond 200 with no body (treated as a miss); pass `status` overrides for
 * explicit 404s. readBodyText is stubbed to echo whatever body we attached.
 */
function stubNetwork(
  responses: Record<string, { xml?: string; status?: number; contentType?: string }>
): void {
  mockPoliteFetch.mockImplementation(async (url: string) => {
    const r = responses[url];
    const status = r?.status ?? (r?.xml !== undefined ? 200 : 404);
    const body =
      status === 200 && r?.xml !== undefined
        ? ({
            __xml: r.xml,
            pipeThrough: vi.fn(() => ({ __xml: r.xml }))
          } as unknown as ReadableStream<Uint8Array>)
        : null;
    return {
      status,
      body,
      etag: null,
      lastModified: null,
      contentType: r?.contentType ?? "application/xml",
      contentEncoding: null
    };
  });
  mockReadBodyText.mockImplementation(async (body: ReadableStream<Uint8Array>) => {
    return (body as unknown as { __xml: string }).__xml;
  });
}

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
      { url: "https://example.com/a&b", lastmod: "2026-02-02" }
    ]);
    expect(parsed.isNews).toBe(false);
  });

  it("recognizes sitemap index files", () => {
    const parsed = parseSitemapXml(INDEX);
    expect(parsed).toEqual({
      kind: "index",
      sitemaps: ["https://example.com/sitemap-1.xml", "https://example.com/sitemap-2.xml"]
    });
  });

  it("detects news sitemaps", () => {
    const news = URLSET.replace(
      "<urlset ",
      '<urlset xmlns:news="http://www.google.com/schemas/sitemap-news/0.9" '
    );
    const parsed = parseSitemapXml(news);
    expect(parsed.kind === "urlset" && parsed.isNews).toBe(true);
  });

  it("parses rss and atom feeds as sitemap url sources", () => {
    const rss = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item><link>https://example.com/post-1</link><pubDate>Mon, 01 Jun 2026 00:00:00 GMT</pubDate></item>
</channel></rss>`;
    const atom = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry><link rel="alternate" href="https://example.com/post-2"/><updated>2026-06-02</updated></entry>
</feed>`;

    expect(parseSitemapXml(rss)).toEqual({
      kind: "urlset",
      entries: [{ url: "https://example.com/post-1", lastmod: "Mon, 01 Jun 2026 00:00:00 GMT" }],
      isNews: false
    });
    expect(parseSitemapXml(atom)).toEqual({
      kind: "urlset",
      entries: [{ url: "https://example.com/post-2", lastmod: "2026-06-02" }],
      isNews: false
    });
  });
});

describe("parseSitemapDocument", () => {
  it("parses plain text sitemap urls", () => {
    expect(
      parseSitemapDocument(
        ["https://example.com/", "", "not-a-url", "https://example.com/docs"].join("\n")
      )
    ).toEqual({
      kind: "urlset",
      entries: [{ url: "https://example.com/" }, { url: "https://example.com/docs" }],
      isNews: false
    });
  });
});

describe("prioritizeShallow", () => {
  it("sorts shallow paths first and caps the result", () => {
    const entries = [
      { url: "https://example.com/a/b/c" },
      { url: "https://example.com/" },
      { url: "https://example.com/a/b" },
      { url: "https://example.com/a" }
    ];
    expect(prioritizeShallow(entries, 3).map((e) => e.url)).toEqual([
      "https://example.com/",
      "https://example.com/a",
      "https://example.com/a/b"
    ]);
  });
});

describe("discoverSitemapEntries", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("falls back to conventional /sitemap.xml when the declared sitemap 404s", async () => {
    stubNetwork({
      "https://stale.example.com/sitemap.xml": { status: 404 },
      "https://example.com/sitemap.xml": { xml: URLSET }
    });

    const result = await discoverSitemapEntries("https://example.com", [
      "https://stale.example.com/sitemap.xml"
    ]);

    expect(result.entries.map((e) => e.url)).toContain("https://example.com/");
    expect(result.found).toEqual(["https://example.com/sitemap.xml"]);
    expect(mockPoliteFetch.mock.calls.map(([url]) => url)).toContain(
      "https://stale.example.com/sitemap.xml"
    );
    expect(mockPoliteFetch.mock.calls.map(([url]) => url)).toContain(
      "https://example.com/sitemap.xml"
    );
  });

  it("does not fetch conventional paths when the declared sitemap works", async () => {
    stubNetwork({ "https://example.com/custom-sitemap.xml": { xml: URLSET } });

    const result = await discoverSitemapEntries("https://example.com", [
      "https://example.com/custom-sitemap.xml"
    ]);

    expect(result.found).toEqual(["https://example.com/custom-sitemap.xml"]);
    expect(mockPoliteFetch).toHaveBeenCalledTimes(1);
    expect(mockPoliteFetch.mock.calls.map(([url]) => url)).not.toContain(
      "https://example.com/sitemap.xml"
    );
    expect(mockPoliteFetch.mock.calls.map(([url]) => url)).not.toContain(
      "https://example.com/sitemap_index.xml"
    );
  });

  it("returns zero entries and does not throw when everything is empty", async () => {
    stubNetwork({});

    const result = await discoverSitemapEntries("https://example.com", [
      "https://example.com/declared.xml"
    ]);

    expect(result.entries).toEqual([]);
    expect(result.found).toEqual([]);
    // declared + both conventional fallbacks attempted
    expect(mockPoliteFetch.mock.calls.map(([url]) => url)).toEqual([
      "https://example.com/declared.xml",
      "https://example.com/sitemap.xml",
      "https://example.com/sitemap_index.xml"
    ]);
  });

  it("does not throw when a fetch rejects", async () => {
    mockPoliteFetch.mockRejectedValue(new Error("network down"));

    const result = await discoverSitemapEntries("https://example.com", [
      "https://example.com/declared.xml"
    ]);

    expect(result.entries).toEqual([]);
    expect(result.found).toEqual([]);
  });

  it("recurses through a declared sitemap index", async () => {
    stubNetwork({
      "https://example.com/sitemap_index.xml": { xml: INDEX },
      "https://example.com/sitemap-1.xml": {
        xml: `<urlset><url><loc>https://example.com/one</loc></url></urlset>`
      },
      "https://example.com/sitemap-2.xml": {
        xml: `<urlset><url><loc>https://example.com/two</loc></url></urlset>`
      }
    });

    const result = await discoverSitemapEntries("https://example.com", [
      "https://example.com/sitemap_index.xml"
    ]);

    expect(result.entries.map((e) => e.url).sort()).toEqual([
      "https://example.com/one",
      "https://example.com/two"
    ]);
    // index recursed, so the conventional fallback should NOT run
    expect(mockPoliteFetch.mock.calls.map(([url]) => url)).not.toContain(
      "https://example.com/sitemap.xml"
    );
  });

  it("handles Stripe-style partitioned sitemap indexes within the default fetch budget", async () => {
    const stripeIndex = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${Array.from({ length: 8 }, (_, i) => `<sitemap><loc>https://stripe.com/sitemap/partition-${i}.xml</loc></sitemap>`).join("")}
</sitemapindex>`;
    stubNetwork({
      "https://stripe.com/sitemap/sitemap.xml": { xml: stripeIndex },
      ...Object.fromEntries(
        Array.from({ length: 8 }, (_, i) => [
          `https://stripe.com/sitemap/partition-${i}.xml`,
          { xml: `<urlset><url><loc>https://stripe.com/page-${i}</loc></url></urlset>` }
        ])
      )
    });

    const result = await discoverSitemapEntries("https://stripe.com", [
      "https://stripe.com/sitemap/sitemap.xml"
    ]);

    expect(result.entries.map((entry) => entry.url)).toEqual(
      Array.from({ length: 8 }, (_, i) => `https://stripe.com/page-${i}`)
    );
    expect(mockPoliteFetch).toHaveBeenCalledTimes(9);
    expect(mockPoliteFetch).toHaveBeenCalledWith(
      "https://stripe.com/sitemap/partition-0.xml",
      expect.objectContaining({ maxBodyBytes: 50 * 1024 * 1024 })
    );
  });

  it("parses gzip sitemap responses", async () => {
    stubNetwork({
      "https://example.com/sitemap.xml.gz": {
        xml: `<urlset><url><loc>https://example.com/gzip</loc></url></urlset>`,
        contentType: "application/gzip"
      }
    });

    const result = await discoverSitemapEntries("https://example.com", [
      "https://example.com/sitemap.xml.gz"
    ]);

    expect(result.entries).toEqual([{ url: "https://example.com/gzip" }]);
  });

  it("does not re-fetch a conventional path already visited as a declared 404", async () => {
    stubNetwork({ "https://example.com/sitemap.xml": { status: 404 } });

    await discoverSitemapEntries("https://example.com", ["https://example.com/sitemap.xml"]);

    const sitemapXmlCalls = mockPoliteFetch.mock.calls.filter(
      ([u]) => u === "https://example.com/sitemap.xml"
    );
    expect(sitemapXmlCalls).toHaveLength(1);
  });
});
