import { describe, expect, it, vi } from "vitest";
import { applyCadencePrior, deriveSignals } from "./crawl-consumer";

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
    expect(deriveSignals({ urls: [], pageCount: 0, isNewsSitemap: false }).hasDatedUrls).toBe(false);
  });
});

/** Records the interval an `update(sites).set(...)` call would persist. */
function fakeDb() {
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
    const { db, written } = fakeDb();
    await applyCadencePrior(db as never, "site1", "initial", {
      urls: ["https://example.com/article"],
      pageCount: 3,
      isNewsSitemap: true, // news sitemap → 6h prior
    });
    expect(written()).toBe(6 * HOUR);
  });

  it("does not overwrite the interval on a monitor re-crawl", async () => {
    const { db, written } = fakeDb();
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
    const { db, written } = fakeDb();
    await applyCadencePrior(db as never, "site1", "manual", {
      urls: [],
      pageCount: 1,
      isNewsSitemap: false,
    });
    expect(written()).toBeUndefined();
  });
});
