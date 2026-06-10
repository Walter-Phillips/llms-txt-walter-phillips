import Anthropic from "@anthropic-ai/sdk";
import type { Inventory } from "./heuristics";

/**
 * Pass 2: structured-output refinement. Writes the blockquote summary,
 * renames H2 sections to user intent, cleans link descriptions, and demotes
 * low-value pages to Optional.
 *
 * URLs are NEVER LLM-generated — only copied from the inventory. Any failure
 * → caller falls back to Pass 1 heuristic output. Validator gates the result.
 */
export async function refine(
  inventory: Inventory,
  apiKey: string,
): Promise<{ summary: string; inventory: Inventory } | null> {
  if (!apiKey) return null;
  const _client = new Anthropic({ apiKey });
  // TODO: structured-output prompt + tool-use schema; map response back to
  // Inventory shape; never accept URLs not present in `inventory`.
  void _client;
  return null;
}
