import { describe, expect, it } from "vitest";
import { initialInterval, nextInterval, nextStreak } from "./schedule";

const HOUR = 3600;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

describe("nextInterval", () => {
  it("halves on change", () => {
    expect(nextInterval(DAY, true)).toBe(12 * HOUR);
  });

  it("backs off 1.5x on no change", () => {
    expect(nextInterval(DAY, false)).toBe(36 * HOUR);
  });

  it("never drops below the 1h floor", () => {
    expect(nextInterval(HOUR, true)).toBe(HOUR);
    expect(nextInterval(90 * 60, true)).toBe(HOUR); // 45m would breach floor
  });

  it("never exceeds the 7d ceiling", () => {
    expect(nextInterval(WEEK, false)).toBe(WEEK);
    expect(nextInterval(6 * DAY, false)).toBe(WEEK); // 9d clamps to 7d
  });
});

describe("initialInterval priors", () => {
  it("news sitemap or RSS implies 6h", () => {
    expect(initialInterval({ hasNewsSitemap: true })).toBe(6 * HOUR);
    expect(initialInterval({ hasRss: true })).toBe(6 * HOUR);
  });

  it("freshness signals beat the tiny-site prior", () => {
    expect(initialInterval({ hasRss: true, pageCount: 5 })).toBe(6 * HOUR);
    expect(initialInterval({ hasDatedUrls: true, pageCount: 5 })).toBe(12 * HOUR);
  });

  it("dated urls imply 12h", () => {
    expect(initialInterval({ hasDatedUrls: true })).toBe(12 * HOUR);
  });

  it("tiny static sites imply 72h", () => {
    expect(initialInterval({ pageCount: 8 })).toBe(72 * HOUR);
  });

  it("defaults to 24h", () => {
    expect(initialInterval({})).toBe(DAY);
    expect(initialInterval({ pageCount: 200 })).toBe(DAY);
  });
});

describe("nextStreak", () => {
  it("extends a positive streak on change", () => {
    expect(nextStreak(2, true)).toBe(3);
  });

  it("extends a negative streak on quiet check", () => {
    expect(nextStreak(-3, false)).toBe(-4);
  });

  it("flips sign and resets on direction change", () => {
    expect(nextStreak(-5, true)).toBe(1);
    expect(nextStreak(4, false)).toBe(-1);
    expect(nextStreak(0, true)).toBe(1);
    expect(nextStreak(0, false)).toBe(-1);
  });
});
