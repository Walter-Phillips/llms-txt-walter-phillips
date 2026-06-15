import { describe, expect, it, vi } from "vitest";
import type { Inventory, InventoryPage, SectionInventory } from "./heuristics";
import { refine, refineWithCaller } from "./llm";

interface PromptPayload {
  sections: { pages: { url: string }[] }[];
}

function expectPresent<T>(value: T | null | undefined): asserts value is T {
  expect(value).toBeDefined();
}

function expectRefinement(
  value: Awaited<ReturnType<typeof refineWithCaller>>,
): asserts value is { summary: string; inventory: Inventory } {
  expect(value).not.toBeNull();
}

function findSection(inventory: Inventory, name: string): SectionInventory {
  const section = inventory.sections.find((candidate) => candidate.name === name);
  expectPresent(section);
  return section;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPromptPayload(value: unknown): value is PromptPayload {
  return isRecord(value) && Array.isArray(value.sections);
}

function parsePromptPayload(prompt: string): PromptPayload {
  const json = prompt.split("Inventory (JSON):\n").at(1);
  expectPresent(json);
  const parsed: unknown = JSON.parse(json);
  if (!isPromptPayload(parsed)) {
    throw new Error("prompt payload did not include sections");
  }
  return parsed;
}

function page(url: string, overrides: Partial<InventoryPage> = {}): InventoryPage {
  return {
    url,
    title: "Title",
    description: "Original description",
    h1: null,
    sectionHint: null,
    ...overrides,
  };
}

function inventory(): Inventory {
  return {
    siteName: "Acme Docs",
    origin: "https://acme.dev",
    homepageSnippet: "Acme builds developer tools.",
    sections: [
      {
        name: "Documentation",
        pages: [page("https://acme.dev/docs"), page("https://acme.dev/docs/install")],
      },
      {
        name: "Core Pages",
        pages: [page("https://acme.dev/about"), page("https://acme.dev/careers")],
      },
    ],
    optional: [page("https://acme.dev/privacy")],
  };
}

describe("refineWithCaller", () => {
  it("maps a happy-path response: renamed sections, descriptions, demotions", async () => {
    const caller = vi.fn().mockResolvedValue({
      summary: "Acme is a developer tools company with documentation for its products.",
      sections: [
        {
          name: "Getting Started",
          pages: [
            { url: "https://acme.dev/docs/install", description: "Install Acme in minutes." },
            { url: "https://acme.dev/docs", description: "Full product documentation." },
          ],
        },
        {
          name: "Company",
          pages: [{ url: "https://acme.dev/about", description: "About the Acme team." }],
        },
      ],
      optional: [
        { url: "https://acme.dev/careers", description: "Open roles." },
        { url: "https://acme.dev/privacy" },
      ],
    });

    const result = await refineWithCaller(inventory(), caller);
    expectRefinement(result);
    expect(result.summary).toBe(
      "Acme is a developer tools company with documentation for its products.",
    );
    expect(result.inventory.sections.map((s) => s.name)).toEqual(["Getting Started", "Company"]);
    // LLM ordering within a section is respected.
    expect(result.inventory.sections[0]?.pages.map((p) => p.url)).toEqual([
      "https://acme.dev/docs/install",
      "https://acme.dev/docs",
    ]);
    // LLM description applied; original page metadata preserved.
    expect(result.inventory.sections[0]?.pages[0]?.description).toBe("Install Acme in minutes.");
    expect(result.inventory.sections[0]?.pages[0]?.title).toBe("Title");
    // Careers demoted; original description kept when LLM gives none.
    expect(result.inventory.optional.map((p) => p.url)).toEqual([
      "https://acme.dev/careers",
      "https://acme.dev/privacy",
    ]);
    expect(result.inventory.optional[1]?.description).toBe("Original description");
    // Untouched site metadata passes through.
    expect(result.inventory.siteName).toBe("Acme Docs");
    expect(result.inventory.origin).toBe("https://acme.dev");
  });

  it("drops hallucinated URLs that were not in the input inventory", async () => {
    const caller = vi.fn().mockResolvedValue({
      summary: "Acme developer tools.",
      sections: [
        {
          name: "Documentation",
          pages: [
            { url: "https://acme.dev/docs" },
            { url: "https://acme.dev/docs/quickstart" }, // hallucinated
            { url: "https://evil.example.com/docs" }, // hallucinated
            { url: "https://acme.dev/docs/install" },
          ],
        },
        {
          name: "Company",
          pages: [{ url: "https://acme.dev/about" }, { url: "https://acme.dev/careers" }],
        },
      ],
      optional: [{ url: "https://acme.dev/privacy" }],
    });

    const result = await refineWithCaller(inventory(), caller);
    expectRefinement(result);
    const urls = result.inventory.sections.flatMap((s) => s.pages.map((p) => p.url));
    expect(urls).toEqual([
      "https://acme.dev/docs",
      "https://acme.dev/docs/install",
      "https://acme.dev/about",
      "https://acme.dev/careers",
    ]);
    expect(urls).not.toContain("https://acme.dev/docs/quickstart");
  });

  it("reinstates pages the LLM omitted instead of losing them", async () => {
    const caller = vi.fn().mockResolvedValue({
      summary: "Acme developer tools.",
      sections: [
        {
          name: "Docs",
          // Omits /docs/install (same original section as /docs).
          pages: [{ url: "https://acme.dev/docs" }],
        },
        {
          name: "Company",
          pages: [{ url: "https://acme.dev/about" }, { url: "https://acme.dev/careers" }],
        },
      ],
      // Omits the originally-optional /privacy page entirely.
      optional: [],
    });

    const result = await refineWithCaller(inventory(), caller);
    expectRefinement(result);
    // /docs/install rejoins its section-mates under the renamed "Docs".
    const documentationSection = findSection(result.inventory, "Docs");
    expect(documentationSection.pages.map((p) => p.url)).toEqual([
      "https://acme.dev/docs",
      "https://acme.dev/docs/install",
    ]);
    // Originally-optional page goes back to optional.
    expect(result.inventory.optional.map((p) => p.url)).toEqual(["https://acme.dev/privacy"]);
  });

  it("recreates an original section when the LLM dropped it entirely", async () => {
    const caller = vi.fn().mockResolvedValue({
      summary: "Acme developer tools.",
      sections: [
        {
          name: "Docs",
          pages: [{ url: "https://acme.dev/docs" }, { url: "https://acme.dev/docs/install" }],
        },
        // "Core Pages" section omitted entirely.
      ],
      optional: [{ url: "https://acme.dev/privacy" }],
    });

    const result = await refineWithCaller(inventory(), caller);
    expectRefinement(result);
    const recreated = findSection(result.inventory, "Core Pages");
    expect(recreated.pages.map((p) => p.url).sort()).toEqual([
      "https://acme.dev/about",
      "https://acme.dev/careers",
    ]);
  });

  it("returns null when the API call throws", async () => {
    const caller = vi.fn().mockRejectedValue(new Error("503 overloaded"));
    await expect(refineWithCaller(inventory(), caller)).resolves.toBeNull();
  });

  it("returns null for malformed responses", async () => {
    for (const bad of [
      null,
      undefined,
      "not json",
      { summary: 42, sections: [] },
      { sections: [{ name: "Docs", pages: [] }] }, // missing summary
      { summary: "ok", sections: [{ name: "Docs", pages: [{ description: "no url" }] }] },
    ]) {
      const caller = vi.fn().mockResolvedValue(bad);
      await expect(refineWithCaller(inventory(), caller)).resolves.toBeNull();
    }
  });

  it("returns null for an empty or whitespace-only summary", async () => {
    const caller = vi.fn().mockResolvedValue({
      summary: "   \n  ",
      sections: [{ name: "Docs", pages: [{ url: "https://acme.dev/docs" }] }],
      optional: [],
    });
    await expect(refineWithCaller(inventory(), caller)).resolves.toBeNull();
  });

  it("never emits empty-named or empty sections", async () => {
    const caller = vi.fn().mockResolvedValue({
      summary: "Acme developer tools.",
      sections: [
        { name: "  ", pages: [{ url: "https://acme.dev/docs" }] },
        { name: "Ghost", pages: [{ url: "https://nowhere.example.com/x" }] },
        {
          name: "Everything",
          pages: [
            { url: "https://acme.dev/docs/install" },
            { url: "https://acme.dev/about" },
            { url: "https://acme.dev/careers" },
          ],
        },
      ],
      optional: [{ url: "https://acme.dev/privacy" }],
    });

    const result = await refineWithCaller(inventory(), caller);
    expectRefinement(result);
    for (const section of result.inventory.sections) {
      expect(section.name.trim().length).toBeGreaterThan(0);
      expect(section.pages.length).toBeGreaterThan(0);
    }
    // /docs (from the blank-named section) is reinstated, not lost.
    const urls = result.inventory.sections.flatMap((s) => s.pages.map((p) => p.url));
    expect(urls).toContain("https://acme.dev/docs");
  });

  it("caps the LLM prompt inventory at 1000 pages", async () => {
    const pages = Array.from({ length: 1_001 }, (_, i) =>
      page(`https://acme.dev/docs/${String(i)}`),
    );
    const largeInventory: Inventory = {
      ...inventory(),
      sections: [{ name: "Documentation", pages }],
      optional: [],
    };
    let prompt = "";
    const caller = vi.fn((input: string) => {
      prompt = input;
      return Promise.resolve({
        summary: "Acme developer tools.",
        sections: [{ name: "Docs", pages: [{ url: "https://acme.dev/docs/0" }] }],
        optional: [],
      });
    });

    await refineWithCaller(largeInventory, caller);

    const payload = parsePromptPayload(prompt);
    expect(payload.sections[0].pages).toHaveLength(1_000);
    expect(payload.sections[0].pages.at(-1)?.url).toBe("https://acme.dev/docs/999");
  });
});

describe("refine", () => {
  it("returns null without an API key and never calls the network", async () => {
    await expect(refine(inventory(), "")).resolves.toBeNull();
    await expect(refine(inventory(), "   ")).resolves.toBeNull();
  });
});
