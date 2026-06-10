import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { crawlRuns, fileVersions, pages, sites } from "@profound-takehome/db";
import type { Env } from "../bindings";
import { buildInventory, type Inventory } from "./heuristics";
import { render } from "./render";
import { validate } from "./validate";
import { refine } from "./llm";

export type GenerationResult = {
  version: number;
  r2Key: string;
};

function defaultSummary(inv: Inventory): string {
  if (inv.homepageSnippet && inv.homepageSnippet.trim().length > 0) {
    return inv.homepageSnippet;
  }
  return `Key pages and documentation for ${inv.siteName}.`;
}

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
  env: Env,
  siteId: string,
  runId: string,
  changeSummary?: string,
): Promise<GenerationResult> {
  const db = drizzle(env.DB);

  const site = await db.select().from(sites).where(eq(sites.id, siteId)).get();
  if (!site) throw new Error(`generate: site not found: ${siteId}`);

  const rows = await db
    .select()
    .from(pages)
    .where(and(eq(pages.siteId, siteId), eq(pages.status, "active")))
    .all();

  const origin = site.domain;

  // Pass 1: deterministic heuristics — this output is the floor.
  const inventory = buildInventory(rows, origin);
  let content = render(inventory, defaultSummary(inventory));
  const baseCheck = validate(content, origin);
  if (!baseCheck.ok) {
    throw new Error(`generate: heuristic output failed validation: ${baseCheck.errors.join("; ")}`);
  }

  // Pass 2: LLM refinement. Any failure — thrown error, null result, or a
  // validation miss on the refined render — ships the Pass 1 output instead.
  try {
    const refined = await refine(inventory, env.ANTHROPIC_API_KEY);
    if (refined) {
      const refinedContent = render(refined.inventory, refined.summary);
      const refinedCheck = validate(refinedContent, origin);
      if (refinedCheck.ok) {
        content = refinedContent;
      } else {
        console.warn("generate: refined output failed validation, shipping pass 1", {
          siteId,
          errors: refinedCheck.errors,
        });
      }
    }
  } catch (err) {
    console.warn("generate: LLM refinement failed, shipping pass 1", { siteId, err });
  }

  const latest = await db
    .select({ version: fileVersions.version })
    .from(fileVersions)
    .where(eq(fileVersions.siteId, siteId))
    .orderBy(desc(fileVersions.version))
    .limit(1)
    .get();
  const version = (latest?.version ?? 0) + 1;
  const r2Key = `${siteId}/v${version}.txt`;

  await env.FILES.put(r2Key, content, {
    httpMetadata: { contentType: "text/plain; charset=utf-8" },
  });

  const now = Math.floor(Date.now() / 1000);
  await db.insert(fileVersions).values({
    id: nanoid(12),
    siteId,
    runId,
    version,
    r2Key,
    changeSummary: changeSummary ?? "initial generation",
    createdAt: now,
  });

  await db
    .update(crawlRuns)
    .set({ status: "done", finishedAt: now })
    .where(eq(crawlRuns.id, runId));

  return { version, r2Key };
}
