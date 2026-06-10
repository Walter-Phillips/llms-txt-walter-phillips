import type { Env } from "../bindings";

export type GenerationResult = {
  version: number;
  r2Key: string;
};

/**
 * Generation entrypoint — the seam between the crawl pipeline and the
 * generator. Called by the crawl-queue "generate" branch once the
 * frontier drains.
 *
 * Contract: reads the page inventory for `siteId` from D1, runs Pass 1
 * heuristics (always) + Pass 2 LLM refinement (when available), validates
 * the output, writes a versioned blob to R2 ({siteId}/v{n}.txt), inserts a
 * file_versions row, and marks the run done. Never throws on LLM failure —
 * falls back to the heuristic output.
 */
export async function generate(
  _env: Env,
  _siteId: string,
  _runId: string,
  _changeSummary?: string,
): Promise<GenerationResult> {
  throw new Error("not implemented: generator pipeline (stream B)");
}
