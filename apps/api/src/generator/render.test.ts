import { describe, expect, it } from "vitest";
import type { Inventory } from "./heuristics";
import { buildInventory, type PageRow } from "./heuristics";
import { render } from "./render";
import { validate } from "./validate";

const ORIGIN = "https://example.com";

const FIXTURE: Inventory = {
  siteName: "Acme",
  origin: ORIGIN,
  homepageSnippet: "Acme makes widgets.",
  sections: [
    {
      name: "Documentation",
      pages: [
        {
          url: `${ORIGIN}/docs`,
          title: "Docs",
          description: "Documentation home.",
          h1: null,
          sectionHint: "Documentation",
        },
        {
          url: `${ORIGIN}/docs/api`,
          title: null,
          description: null,
          h1: "API Reference",
          sectionHint: "Documentation",
        },
      ],
    },
    {
      name: "Products",
      pages: [
        {
          url: `${ORIGIN}/pricing`,
          title: "Pricing [2025] | Acme",
          description: null,
          h1: null,
          sectionHint: "Products",
        },
      ],
    },
  ],
  optional: [
    {
      url: `${ORIGIN}/privacy`,
      title: "Privacy",
      description: "Privacy policy.",
      h1: null,
      sectionHint: "Optional",
    },
  ],
};

describe("render", () => {
  it("emits H1, blockquote, sections, and Optional last", () => {
    const out = render(FIXTURE, "Acme makes widgets.");
    const lines = out.split("\n");
    expect(lines[0]).toBe("# Acme");
    expect(lines[2]).toBe("> Acme makes widgets.");
    expect(out.indexOf("## Documentation")).toBeLessThan(out.indexOf("## Optional"));
    expect(out).toContain("- [Docs](https://example.com/docs): Documentation home.");
  });

  it("falls back to h1 for the title and synthesizes a description", () => {
    const out = render(FIXTURE, "s");
    expect(out).toContain("- [API Reference](https://example.com/docs/api): API Reference (Documentation).");
  });

  it("never emits a bare trailing colon", () => {
    const out = render(FIXTURE, "s");
    for (const line of out.split("\n")) {
      expect(line).not.toMatch(/:\s*$/);
    }
  });

  it("sanitizes square brackets in titles", () => {
    const out = render(FIXTURE, "s");
    expect(out).toContain("- [Pricing (2025) | Acme](https://example.com/pricing):");
  });

  it("round-trips through validate()", () => {
    expect(validate(render(FIXTURE, "Acme makes widgets."), ORIGIN)).toEqual({ ok: true });
  });

  it("round-trips a heuristics-built inventory through validate()", () => {
    const rows: PageRow[] = [
      {
        url: `${ORIGIN}/`,
        title: "Acme | Widgets",
        description: "Acme makes widgets.",
        h1: "Acme",
        snippet: null,
        sectionHint: null,
      },
      // Bare page: no title/description anywhere — must still render a valid line.
      { url: `${ORIGIN}/x/y`, title: null, description: null, h1: null, snippet: null, sectionHint: null },
      { url: `${ORIGIN}/terms`, title: "Terms", description: null, h1: null, snippet: null, sectionHint: null },
    ];
    const inv = buildInventory(rows, ORIGIN);
    const out = render(inv, inv.homepageSnippet ?? `Key pages for ${inv.siteName}.`);
    expect(validate(out, ORIGIN)).toEqual({ ok: true });
  });
});
