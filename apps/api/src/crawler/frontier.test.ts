import { describe, expect, it } from "vitest";
import { acceptUrls, shouldCrawl } from "./frontier";

describe("shouldCrawl", () => {
  it("blocks known low-value paths", () => {
    expect(shouldCrawl("/search?q=x", [])).toBe(false);
    expect(shouldCrawl("/login", [])).toBe(false);
    expect(shouldCrawl("/blog/page/5", [])).toBe(false);
  });

  it("blocks non-HTML extensions", () => {
    expect(shouldCrawl("/logo.png", [])).toBe(false);
    expect(shouldCrawl("/styles.css", [])).toBe(false);
  });

  it("respects robots disallow prefixes", () => {
    expect(shouldCrawl("/private/x", ["/private"])).toBe(false);
    expect(shouldCrawl("/public/x", ["/private"])).toBe(true);
  });
});

describe("acceptUrls", () => {
  const base = {
    baseUrl: "https://example.com/docs/",
    origin: "https://example.com",
    seen: new Set<string>(),
    disallow: [] as string[],
    pageBudget: 100,
  };

  it("resolves relative links, filters cross-origin, dedupes", () => {
    const accepted = acceptUrls({
      ...base,
      candidates: [
        "/a",
        "intro",
        "https://other.com/x",
        "/a#frag",
        "/a?utm_source=tw",
        "mailto:x@example.com",
      ],
    });
    expect(accepted).toEqual(["https://example.com/a", "https://example.com/docs/intro"]);
  });

  it("skips already-seen URLs and honors the budget", () => {
    const accepted = acceptUrls({
      ...base,
      seen: new Set(["https://example.com/a"]),
      pageBudget: 1,
      candidates: ["/a", "/b", "/c"],
    });
    expect(accepted).toEqual(["https://example.com/b"]);
  });

  it("applies robots disallow", () => {
    const accepted = acceptUrls({
      ...base,
      disallow: ["/private"],
      candidates: ["/private/x", "/ok"],
    });
    expect(accepted).toEqual(["https://example.com/ok"]);
  });
});
