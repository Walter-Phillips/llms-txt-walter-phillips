import { describe, expect, it, vi } from "vitest";
import { aliasSitemapEntries, applyCadencePrior, deriveSignals } from "./crawl-discovery";

const HOUR = 3600;

describe("deriveSignals", () => {
  it("flags a news sitemap and counts pages", () => {
    expect(
      deriveSignals({
        urls: ["https://example.com/", "https://example.com/article"],
        pageCount: 2,
        isNewsSitemap: true,
      }),
    ).toEqual({ pageCount: 2, hasNewsSitemap: true, hasDatedUrls: false });
  });

  it("flags dated urls only when a meaningful share matches", () => {
    const dated = deriveSignals({
      urls: [
        "https://example.com/2024/06/a",
        "https://example.com/2024/05/b",
        "https://example.com/about",
      ],
      pageCount: 3,
      isNewsSitemap: false,
    });
    expect(dated.hasDatedUrls).toBe(true);

    const sparse = deriveSignals({
      urls: [
        "https://example.com/2024/06/a",
        "https://example.com/about",
        "https://example.com/docs",
        "https://example.com/pricing",
        "https://example.com/contact",
        "https://example.com/team",
      ],
      pageCount: 6,
      isNewsSitemap: false,
    });
    expect(sparse.hasDatedUrls).toBe(false);
  });

  it("does not flag dated urls for an empty url set", () => {
    expect(deriveSignals({ urls: [], pageCount: 0, isNewsSitemap: false }).hasDatedUrls).toBe(
      false,
    );
  });
});

describe("aliasSitemapEntries", () => {
  const origin = "https://www.walterphillips.me";

  it("rewrites a single foreign origin onto the entered origin", () => {
    const result = aliasSitemapEntries(
      [
        { url: "https://walter-phillips.github.io/", lastmod: "2024-01-01" },
        { url: "https://walter-phillips.github.io/about" },
        { url: "https://walter-phillips.github.io/blog/post" },
      ],
      origin,
    );
    expect(result).toEqual([
      { url: "https://www.walterphillips.me/", lastmod: "2024-01-01" },
      { url: "https://www.walterphillips.me/about" },
      { url: "https://www.walterphillips.me/blog/post" },
    ]);
  });

  it("preserves path, query, and hash while rewriting", () => {
    const result = aliasSitemapEntries(
      [{ url: "https://canonical.github.io/docs?page=2#section", lastmod: "2024-06-01" }],
      origin,
    );
    expect(result).toEqual([
      { url: "https://www.walterphillips.me/docs?page=2#section", lastmod: "2024-06-01" },
    ]);
  });

  it("leaves already-same-origin entries unchanged", () => {
    const entries = [
      { url: "https://www.walterphillips.me/", lastmod: "2024-01-01" },
      { url: "https://www.walterphillips.me/about" },
    ];
    expect(aliasSitemapEntries(entries, origin)).toEqual(entries);
  });

  it("does not rewrite mixed origins", () => {
    const entries = [
      { url: "https://www.walterphillips.me/" },
      { url: "https://walter-phillips.github.io/about" },
    ];
    expect(aliasSitemapEntries(entries, origin)).toEqual(entries);
  });

  it("returns an empty list unchanged", () => {
    expect(aliasSitemapEntries([], origin)).toEqual([]);
  });

  it("tolerates unparseable urls when counting origins", () => {
    const entries = [{ url: "not a url" }, { url: "https://walter-phillips.github.io/about" }];
    // Only one parseable foreign origin → that entry is rewritten, the bad one
    // is left as-is.
    expect(aliasSitemapEntries(entries, origin)).toEqual([
      { url: "not a url" },
      { url: "https://www.walterphillips.me/about" },
    ]);
  });
});

/**
 * Records the interval an `update(sites).set(...)` call would persist.
 * @returns Fake database and the last interval written through it.
 */
function fakeDatabase(): {
  db: {
    update: () => { set: (vals: { checkIntervalS: number }) => { where: () => Promise<void> } };
  };
  written: () => number | undefined;
} {
  let written: number | undefined;
  const db = {
    update: () => ({
      set: (vals: { checkIntervalS: number }) => {
        written = vals.checkIntervalS;
        return { where: () => Promise.resolve() };
      },
    }),
  };
  return { db, written: () => written };
}

describe("applyCadencePrior", () => {
  it("sets checkIntervalS from signals on the initial crawl", async () => {
    const { db, written } = fakeDatabase();
    await applyCadencePrior(db as never, "site1", "initial", {
      urls: ["https://example.com/article"],
      pageCount: 3,
      isNewsSitemap: true, // news sitemap → 6h prior
    });
    expect(written()).toBe(6 * HOUR);
  });

  it("does not overwrite the interval on a monitor re-crawl", async () => {
    const { db, written } = fakeDatabase();
    const spy = vi.spyOn(db, "update");
    await applyCadencePrior(db as never, "site1", "monitor", {
      urls: ["https://example.com/article"],
      pageCount: 3,
      isNewsSitemap: true,
    });
    expect(written()).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not overwrite the interval on a manual re-crawl", async () => {
    const { db, written } = fakeDatabase();
    await applyCadencePrior(db as never, "site1", "manual", {
      urls: [],
      pageCount: 1,
      isNewsSitemap: false,
    });
    expect(written()).toBeUndefined();
  });
});
