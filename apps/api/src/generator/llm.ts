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
const MAX_PAGES = 1_000;
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

const llmPageSchema = z.object({ url: z.string(), description: z.string().nullish() });
const llmSectionSchema = z.object({ name: z.string(), pages: z.array(llmPageSchema) });
const llmResponseSchema = z.object({
  summary: z.string(),
  sections: z.array(llmSectionSchema),
  optional: z.array(llmPageSchema).default([]),
});

type LlmResponse = z.infer<typeof llmResponseSchema>;
type LlmPage = z.infer<typeof llmPageSchema>;

interface PageIndex {
  knownPages: Map<string, InventoryPage>;
  originalSectionOf: Map<string, number>;
  originallyOptional: Set<string>;
}

interface MappingState extends PageIndex {
  placed: Set<string>;
  outSectionOf: Map<string, number>;
}

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
                url: { type: "string", description: "Must be copied verbatim from the inventory." },
                description: { type: "string", description: "One-line page description." },
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
      description: "Low-value pages (legal, careers, boilerplate) demoted to the Optional section.",
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
    return toolUse?.type === "tool_use" ? toolUse.input : null;
  };
}

/**
 * Refine a deterministic inventory through Anthropic when an API key exists.
 * @param inventory First-pass inventory to refine.
 * @param apiKey Anthropic API key for the model call.
 * @returns Refined summary and inventory, or null on missing key or failure.
 */
export async function refine(
  inventory: Inventory,
  apiKey: string,
): Promise<{ summary: string; inventory: Inventory } | null> {
  if (apiKey.trim().length === 0) return null;
  return refineWithCaller(inventory, buildAnthropicCaller(apiKey));
}

/**
 * Core refinement with an injectable API caller. Never throws; any failure
 * (API error, malformed response, empty result) returns null.
 * @param inventory First-pass inventory to refine.
 * @param callTool Testable tool-call function that returns raw model output.
 * @returns Refined summary and inventory, or null when guardrails reject it.
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
  if (value === null) return null;
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

interface PromptPage {
  url: string;
  title: string | null;
  description: string | null;
  h1: string | null;
}

function promptPage(page: InventoryPage): PromptPage {
  return {
    url: page.url,
    title: truncate(page.title, MAX_FIELD_CHARS),
    description: truncate(page.description, MAX_FIELD_CHARS),
    h1: truncate(page.h1, MAX_FIELD_CHARS),
  };
}

function buildPrompt(inventory: Inventory): string {
  let budget = MAX_PAGES;
  const sections: { name: string; pages: PromptPage[] }[] = [];
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
    "You are refining a machine-generated llms.txt inventory for a website so that it is maximally useful to an LLM consuming it.",
    "",
    "Tasks:",
    "1. Write a 1-2 sentence description of what this site does and who it is for, based solely on the inventory below. Do not speculate or infer beyond what is present.",
    "2. Rename and reorder sections to reflect user intent. Prefer action-oriented names ('Getting Started', 'API Reference') over generic ones ('Misc', 'Other'). Put the most task-relevant sections first.",
    "3. Write a concise one-line description for each page that describes what the page contains or enables — not just a restatement of its title. Keep descriptions under 200 characters.",
    "4. Demote low-value pages (legal, terms of service, privacy policy, careers, press, boilerplate) to the optional list.",
    "",
    "Rules:",
    "- CRITICAL: Use page URLs exactly as they appear in the inventory. Do not alter, abbreviate, or invent any URL.",
    "- Every section must have a non-empty name and contain at least one page.",
    "- Every page in the inventory must appear in the output exactly once — either in a section or the optional list. If you are unsure where a page belongs, place it in the section whose topic is closest to the page's apparent content.",
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

function indexOriginalPages(original: Inventory): PageIndex {
  const knownPages = new Map<string, InventoryPage>();
  const originalSectionOf = new Map<string, number>();
  const originallyOptional = new Set<string>();

  original.sections.forEach((section, index) => {
    for (const page of section.pages) {
      if (knownPages.has(page.url)) continue;
      knownPages.set(page.url, page);
      originalSectionOf.set(page.url, index);
    }
  });

  for (const page of original.optional) {
    if (knownPages.has(page.url)) continue;
    knownPages.set(page.url, page);
    originallyOptional.add(page.url);
  }

  return { knownPages, originalSectionOf, originallyOptional };
}

function acceptPage(candidate: LlmPage, state: MappingState): InventoryPage | null {
  const known = state.knownPages.get(candidate.url);
  if (!known || state.placed.has(candidate.url)) return null;
  state.placed.add(candidate.url);
  const description = sanitizeLine(candidate.description, MAX_DESCRIPTION_CHARS);
  return { ...known, description: description ?? known.description };
}

function mapOutputSections(
  sections: LlmResponse["sections"],
  state: MappingState,
): SectionInventory[] {
  const outSections: SectionInventory[] = [];

  for (const section of sections) {
    const name = sanitizeLine(section.name, MAX_SECTION_NAME_CHARS);
    if (!name) continue;
    const pages = section.pages
      .map((candidate) => acceptPage(candidate, state))
      .filter((page): page is InventoryPage => page !== null);
    if (pages.length === 0) continue;
    for (const page of pages) state.outSectionOf.set(page.url, outSections.length);
    outSections.push({ name, pages });
  }

  return outSections;
}

function mapOptionalPages(optional: LlmResponse["optional"], state: MappingState): InventoryPage[] {
  return optional
    .map((candidate) => acceptPage(candidate, state))
    .filter((page): page is InventoryPage => page !== null);
}

function collectStrays(state: MappingState): Map<number, InventoryPage[]> {
  const strays = new Map<number, InventoryPage[]>();

  for (const [url, page] of state.knownPages) {
    if (state.placed.has(url) || state.originallyOptional.has(url)) continue;
    const sectionIndex = state.originalSectionOf.get(url);
    if (sectionIndex === undefined) continue;
    strays.set(sectionIndex, [...(strays.get(sectionIndex) ?? []), page]);
  }

  return strays;
}

function reinstateOmittedPages(
  original: Inventory,
  state: MappingState,
  output: { sections: SectionInventory[]; optional: InventoryPage[] },
): void {
  for (const [url, page] of state.knownPages) {
    if (!state.placed.has(url) && state.originallyOptional.has(url)) output.optional.push(page);
  }

  for (const [sectionIndex, pages] of collectStrays(state)) {
    const section = original.sections[sectionIndex];
    const target = majorityDestination(section, state.outSectionOf);
    const destination = target === null ? undefined : output.sections[target];
    if (destination) destination.pages.push(...pages);
    else output.sections.push({ name: section.name, pages });
  }
}

function mapResponse(
  original: Inventory,
  response: LlmResponse,
): { summary: string; inventory: Inventory } | null {
  const summary = sanitizeLine(response.summary, MAX_SUMMARY_CHARS);
  if (!summary) return null;

  // Index every known page; anything outside this set is hallucinated → drop.
  const pageIndex = indexOriginalPages(original);
  const state: MappingState = {
    ...pageIndex,
    placed: new Set<string>(),
    outSectionOf: new Map<string, number>(),
  };
  const outSections = mapOutputSections(response.sections, state);
  const outOptional = mapOptionalPages(response.optional, state);

  // Reinstate pages the LLM omitted (or that were capped out of the prompt):
  // optional pages go back to optional; section pages follow wherever the
  // majority of their original section landed, else their original section
  // is recreated at the end. Omitted pages must never be lost.
  reinstateOmittedPages(original, state, { sections: outSections, optional: outOptional });

  if (state.knownPages.size > 0 && outSections.length === 0 && outOptional.length === 0) {
    return null;
  }

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

/**
 * Output section index where most pages of `section` ended up, or null.
 * @param section Original section whose pages may have been moved.
 * @param outSectionOf Map from URL to output section index.
 * @returns Output section index with the most votes, or null.
 */
function majorityDestination(
  section: SectionInventory,
  outSectionOf: Map<string, number>,
): number | null {
  const votes = new Map<number, number>();
  for (const page of section.pages) {
    const index = outSectionOf.get(page.url);
    if (index === undefined) continue;
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
