import { describe, expect, it } from "vitest";
import {
  buildInventory,
  classify,
  MAX_LINKS_PER_SECTION,
  rankPages,
  resolveSiteName,
  stripTitleSuffix,
  type PageRow,
} from "./heuristics";

const ORIGIN = "https://example.com";

function row(partial: Partial<PageRow> & { url: string }): PageRow {
  return {
    title: null,
    description: null,
    h1: null,
    snippet: null,
    sectionHint: null,
    ...partial,
  };
}

describe("stripTitleSuffix", () => {
  it("strips ' | Brand' suffixes", () => {
    expect(stripTitleSuffix("Acme | The Widget Company")).toBe("Acme");
  });

  it("strips en-dash and hyphen suffixes", () => {
    expect(stripTitleSuffix("Acme – Home")).toBe("Acme");
    expect(stripTitleSuffix("Acme - Home")).toBe("Acme");
    expect(stripTitleSuffix("Acme — Home")).toBe("Acme");
  });

  it("leaves suffix-free titles alone", () => {
    expect(stripTitleSuffix("Acme")).toBe("Acme");
    expect(stripTitleSuffix("Acme-Widgets")).toBe("Acme-Widgets");
  });
});

describe("resolveSiteName", () => {
  it("uses the homepage title with suffix stripped", () => {
    const rows = [row({ url: `${ORIGIN}/`, title: "Acme | Widgets for everyone" })];
    expect(resolveSiteName(rows, ORIGIN)).toBe("Acme");
  });

  it("falls back to the domain when no homepage title", () => {
    const rows = [row({ url: `${ORIGIN}/docs` , title: "Docs" })];
    expect(resolveSiteName(rows, ORIGIN)).toBe("example.com");
  });
});

describe("classify", () => {
  it("maps docs-like paths to Documentation", () => {
    expect(classify("/docs/getting-started").section).toBe("Documentation");
    expect(classify("/api/reference").section).toBe("Documentation");
  });

  it("maps dated paths to Blog", () => {
    expect(classify("/2024/05/launch").section).toBe("Blog");
  });

  it("marks legal pages optional", () => {
    expect(classify("/privacy")).toEqual({ section: "Optional", optional: true });
  });

  it("defaults to Core Pages", () => {
    expect(classify("/some/random/page")).toEqual({ section: "Core Pages", optional: false });
  });
});

describe("rankPages", () => {
  it("ranks shallower paths first", () => {
    const deep = row({ url: `${ORIGIN}/docs/a/b/c`, title: "Deep" });
    const shallow = row({ url: `${ORIGIN}/docs`, title: "Docs" });
    expect(rankPages([deep, shallow])[0]).toBe(shallow);
  });

  it("ranks titled+described pages above bare ones at equal depth", () => {
    const bare = row({ url: `${ORIGIN}/docs/a` });
    const rich = row({ url: `${ORIGIN}/docs/b`, title: "B", description: "About B" });
    expect(rankPages([bare, rich])[0]).toBe(rich);
  });
});

describe("buildInventory", () => {
  it("builds sections, homepage snippet, and excludes the homepage link", () => {
    const rows = [
      row({ url: `${ORIGIN}/`, title: "Acme | Widgets", description: "Acme makes widgets." }),
      row({ url: `${ORIGIN}/docs`, title: "Docs", description: "Documentation home." }),
      row({ url: `${ORIGIN}/pricing`, title: "Pricing" }),
      row({ url: `${ORIGIN}/privacy`, title: "Privacy Policy" }),
    ];
    const inv = buildInventory(rows, ORIGIN);

    expect(inv.siteName).toBe("Acme");
    expect(inv.origin).toBe(ORIGIN);
    expect(inv.homepageSnippet).toBe("Acme makes widgets.");

    const urls = inv.sections.flatMap((s) => s.pages.map((p) => p.url));
    expect(urls).toContain(`${ORIGIN}/docs`);
    expect(urls).toContain(`${ORIGIN}/pricing`);
    expect(urls).not.toContain(`${ORIGIN}/`);

    expect(inv.optional.map((p) => p.url)).toEqual([`${ORIGIN}/privacy`]);
  });

  it("orders sections deterministically (Documentation before Blog)", () => {
    const rows = [
      row({ url: `${ORIGIN}/blog/post`, title: "Post" }),
      row({ url: `${ORIGIN}/docs/start`, title: "Start" }),
    ];
    const inv = buildInventory(rows, ORIGIN);
    expect(inv.sections.map((s) => s.name)).toEqual(["Documentation", "Blog"]);
  });

  it("caps sections and demotes overflow to Optional", () => {
    const rows = Array.from({ length: MAX_LINKS_PER_SECTION + 3 }, (_, i) =>
      row({ url: `${ORIGIN}/docs/page-${i}`, title: `Page ${i}`, description: `Desc ${i}` }),
    );
    const inv = buildInventory(rows, ORIGIN);
    const docs = inv.sections.find((s) => s.name === "Documentation")!;
    expect(docs.pages).toHaveLength(MAX_LINKS_PER_SECTION);
    expect(inv.optional).toHaveLength(3);
  });

  it("uses snippet as description fallback", () => {
    const rows = [row({ url: `${ORIGIN}/docs`, title: "Docs", snippet: "From the page body." })];
    const inv = buildInventory(rows, ORIGIN);
    expect(inv.sections[0]!.pages[0]!.description).toBe("From the page body.");
  });
});
