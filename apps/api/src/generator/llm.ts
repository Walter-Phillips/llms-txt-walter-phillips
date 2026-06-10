import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Inventory, InventoryPage, SectionInventory } from "./heuristics";

/**
 * Pass 2: structured-output refinement. Writes the blockquote summary,
 * renames H2 sections to user intent, cleans link descriptions, and demotes
 * low-value pages to Optional.
 *
 * URLs are NEVER LLM-generated — only copied from the inventory. Any failure
 * → caller falls back to Pass 1 heuristic output. Validator gates the result.
 */

const MODEL = "claude-sonnet-4-6";
const TEMPERATURE = 0.2;
const MAX_TOKENS = 8192;
/** Cap on how many pages we send to the model. */
const MAX_PAGES = 150;
/** Truncation limits for prompt fields. */
const MAX_FIELD_CHARS = 160;
const MAX_SNIPPET_CHARS = 600;
/** Sanitization limits for output fields. */
const MAX_SUMMARY_CHARS = 400;
const MAX_SECTION_NAME_CHARS = 80;
const MAX_DESCRIPTION_CHARS = 200;

// ---------------------------------------------------------------------------
// Response schema — pages are referenced strictly by URL. URLs that do not
// appear in the input inventory are silently dropped during mapping.
// ---------------------------------------------------------------------------

const llmPageSchema = z.object({
  url: z.string(),
  description: z.string().nullish(),
});

const llmSectionSchema = z.object({
  name: z.string(),
  pages: z.array(llmPageSchema),
});

const llmResponseSchema = z.object({
  summary: z.string(),
  sections: z.array(llmSectionSchema),
  optional: z.array(llmPageSchema).default([]),
});

type LlmResponse = z.infer<typeof llmResponseSchema>;

/** JSON Schema mirror of `llmResponseSchema` for forced tool use. */
const TOOL_NAME = "emit_llms_txt_plan";
const TOOL_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    summary: {
      type: "string",
      description:
        "1-2 sentence description of what the site IS, grounded only in the provided inventory. No marketing fluff, no speculation.",
    },
    sections: {
      type: "array",
      description:
        "Sections ordered by usefulness to a reader (e.g. Getting Started, Documentation before About). Every page belongs to exactly one section or the optional list.",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short, intent-oriented section name." },
          pages: {
            type: "array",
            items: {
              type: "object",
              properties: {
                url: {
                  type: "string",
                  description: "Must be copied verbatim from the inventory. Never invent URLs.",
                },
                description: {
                  type: "string",
                  description: "One-line description of the page (under 200 chars).",
                },
              },
              required: ["url"],
            },
          },
        },
        required: ["name", "pages"],
      },
    },
    optional: {
      type: "array",
      description:
        "Low-value pages (legal, careers, boilerplate) demoted to the Optional section.",
      items: {
        type: "object",
        properties: {
          url: { type: "string" },
          description: { type: "string" },
        },
        required: ["url"],
      },
    },
  },
  required: ["summary", "sections", "optional"],
};

// ---------------------------------------------------------------------------
// Injectable API seam — tests stub this; production builds it from the SDK.
// ---------------------------------------------------------------------------

/** Sends the prompt and returns the raw (unvalidated) tool input, or null. */
export type ToolCaller = (prompt: string) => Promise<unknown>;

function buildAnthropicCaller(apiKey: string): ToolCaller {
  const client = new Anthropic({ apiKey });
  return async (prompt: string) => {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      tools: [
        {
          name: TOOL_NAME,
          description:
            "Emit the refined llms.txt plan: summary, renamed/reordered sections, per-page descriptions, and demotions to optional.",
          input_schema: TOOL_INPUT_SCHEMA,
        },
      ],
      tool_choice: { type: "tool", name: TOOL_NAME },
      messages: [{ role: "user", content: prompt }],
    });
    const toolUse = message.content.find((block) => block.type === "tool_use");
    return toolUse && toolUse.type === "tool_use" ? toolUse.input : null;
  };
}

export async function refine(
  inventory: Inventory,
  apiKey: string,
): Promise<{ summary: string; inventory: Inventory } | null> {
  if (!apiKey || !apiKey.trim()) return null;
  return refineWithCaller(inventory, buildAnthropicCaller(apiKey));
}

/**
 * Core refinement with an injectable API caller. Never throws; any failure
 * (API error, malformed response, empty result) returns null.
 */
export async function refineWithCaller(
  inventory: Inventory,
  callTool: ToolCaller,
): Promise<{ summary: string; inventory: Inventory } | null> {
  try {
    const raw = await callTool(buildPrompt(inventory));
    const parsed = llmResponseSchema.safeParse(raw);
    if (!parsed.success) return null;
    return mapResponse(inventory, parsed.data);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Prompt construction (capped + truncated)
// ---------------------------------------------------------------------------

function truncate(value: string | null, max: number): string | null {
  if (value == null) return null;
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

function promptPage(page: InventoryPage) {
  return {
    url: page.url,
    title: truncate(page.title, MAX_FIELD_CHARS),
    description: truncate(page.description, MAX_FIELD_CHARS),
    h1: truncate(page.h1, MAX_FIELD_CHARS),
  };
}

function buildPrompt(inventory: Inventory): string {
  let budget = MAX_PAGES;
  const sections: Array<{ name: string; pages: ReturnType<typeof promptPage>[] }> = [];
  for (const section of inventory.sections) {
    if (budget <= 0) break;
    const pages = section.pages.slice(0, budget).map(promptPage);
    budget -= pages.length;
    if (pages.length) sections.push({ name: section.name, pages });
  }
  const optional = inventory.optional.slice(0, Math.max(budget, 0)).map(promptPage);

  const payload = {
    siteName: inventory.siteName,
    origin: inventory.origin,
    homepageSnippet: truncate(inventory.homepageSnippet, MAX_SNIPPET_CHARS),
    sections,
    optional,
  };

  return [
    "You are refining a machine-generated llms.txt inventory for a website.",
    "",
    "Tasks:",
    "1. Write a 1-2 sentence summary of what the site IS, grounded ONLY in the inventory below. Do not speculate beyond it.",
    '2. Rename and reorder sections toward user intent ("Getting Started" beats "Misc Pages"). Put the most useful sections first.',
    "3. Write or clean a one-line description for each link (factual, under 200 characters).",
    "4. Demote low-value pages (legal, terms, careers, boilerplate) to the optional list.",
    "",
    "Rules:",
    "- Reference pages ONLY by the exact `url` strings given below. Never invent, alter, or guess URLs.",
    "- Every section must have a non-empty name and at least one page.",
    "- Do not drop pages; if unsure where a page belongs, keep it in a section close to its current one.",
    "",
    "Inventory (JSON):",
    JSON.stringify(payload, null, 2),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Response mapping — guardrails live here.
// ---------------------------------------------------------------------------

function sanitizeLine(value: string | null | undefined, max: number): string | null {
  return truncate(value ?? null, max);
}

function mapResponse(
  original: Inventory,
  response: LlmResponse,
): { summary: string; inventory: Inventory } | null {
  const summary = sanitizeLine(response.summary, MAX_SUMMARY_CHARS);
  if (!summary) return null;

  // Index every known page; anything outside this set is hallucinated → drop.
  const knownPages = new Map<string, InventoryPage>();
  const originalSectionOf = new Map<string, number>(); // url -> original section index
  original.sections.forEach((section, index) => {
    for (const page of section.pages) {
      if (knownPages.has(page.url)) continue;
      knownPages.set(page.url, page);
      originalSectionOf.set(page.url, index);
    }
  });
  const originallyOptional = new Set<string>();
  for (const page of original.optional) {
    if (knownPages.has(page.url)) continue;
    knownPages.set(page.url, page);
    originallyOptional.add(page.url);
  }

  const placed = new Set<string>();
  const outSections: SectionInventory[] = [];
  const outSectionOf = new Map<string, number>(); // url -> output section index

  const acceptPage = (candidate: z.infer<typeof llmPageSchema>): InventoryPage | null => {
    const known = knownPages.get(candidate.url);
    if (!known || placed.has(candidate.url)) return null;
    placed.add(candidate.url);
    const description = sanitizeLine(candidate.description, MAX_DESCRIPTION_CHARS);
    return { ...known, description: description ?? known.description };
  };

  for (const section of response.sections) {
    const name = sanitizeLine(section.name, MAX_SECTION_NAME_CHARS);
    if (!name) continue;
    const pages: InventoryPage[] = [];
    for (const candidate of section.pages) {
      const page = acceptPage(candidate);
      if (page) pages.push(page);
    }
    if (!pages.length) continue;
    for (const page of pages) outSectionOf.set(page.url, outSections.length);
    outSections.push({ name, pages });
  }

  const outOptional: InventoryPage[] = [];
  for (const candidate of response.optional) {
    const page = acceptPage(candidate);
    if (page) outOptional.push(page);
  }

  // Reinstate pages the LLM omitted (or that were capped out of the prompt):
  // optional pages go back to optional; section pages follow wherever the
  // majority of their original section landed, else their original section
  // is recreated at the end. Omitted pages must never be lost.
  const strays = new Map<number, InventoryPage[]>(); // original section index -> pages
  for (const [url, page] of knownPages) {
    if (placed.has(url)) continue;
    if (originallyOptional.has(url)) {
      outOptional.push(page);
      continue;
    }
    const sectionIndex = originalSectionOf.get(url);
    if (sectionIndex == null) continue;
    const list = strays.get(sectionIndex) ?? [];
    list.push(page);
    strays.set(sectionIndex, list);
  }

  for (const [sectionIndex, pages] of strays) {
    const target = majorityDestination(original.sections[sectionIndex], outSectionOf);
    if (target != null) {
      outSections[target].pages.push(...pages);
    } else {
      outSections.push({ name: original.sections[sectionIndex].name, pages });
    }
  }

  if (knownPages.size > 0 && outSections.length === 0 && outOptional.length === 0) return null;

  return {
    summary,
    inventory: {
      siteName: original.siteName,
      origin: original.origin,
      homepageSnippet: original.homepageSnippet,
      sections: outSections,
      optional: outOptional,
    },
  };
}

/** Output section index where most pages of `section` ended up, or null. */
function majorityDestination(
  section: SectionInventory,
  outSectionOf: Map<string, number>,
): number | null {
  const votes = new Map<number, number>();
  for (const page of section.pages) {
    const index = outSectionOf.get(page.url);
    if (index == null) continue;
    votes.set(index, (votes.get(index) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [index, count] of votes) {
    if (count > bestCount) {
      best = index;
      bestCount = count;
    }
  }
  return best;
}
