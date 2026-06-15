import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq, gte } from "drizzle-orm";
import { nanoid } from "nanoid";
import { crawlRuns, fileVersions, pages, sites } from "@profound-takehome/db";
import type { Environment } from "../bindings";
import { logInfo, logWarn } from "../observability/logger";
import { captureHandledException } from "../observability/sentry";
import { buildInventory, type Inventory } from "./heuristics";
import { render } from "./render";
import { validate } from "./validate";
import { refine } from "./llm";

type Database = ReturnType<typeof drizzle>;

export interface GenerationResult {
  version: number;
  r2Key: string;
}

interface GenerationContext {
  db: Database;
  env: Environment;
  siteId: string;
  runId: string;
}

interface RenderedGeneration {
  content: string;
  generatedBy: "heuristic" | "llm-refined";
}

function defaultSummary(inv: Inventory): string {
  if (inv.homepageSnippet && inv.homepageSnippet.trim().length > 0) {
    return inv.homepageSnippet;
  }
  return `Key pages and documentation for ${inv.siteName}.`;
}

async function finishRun({ db, runId }: GenerationContext): Promise<void> {
  await db
    .update(crawlRuns)
    .set({ status: "done", finishedAt: Math.floor(Date.now() / 1000) })
    .where(eq(crawlRuns.id, runId));
}

async function existingGeneration({
  db,
  siteId,
  runId,
}: GenerationContext): Promise<GenerationResult | null> {
  const existing = await db
    .select({ version: fileVersions.version, r2Key: fileVersions.r2Key })
    .from(fileVersions)
    .where(and(eq(fileVersions.siteId, siteId), eq(fileVersions.runId, runId)))
    .get();
  return existing ?? null;
}

async function nextVersion(db: Database, siteId: string): Promise<number> {
  const latest = await db
    .select({ version: fileVersions.version })
    .from(fileVersions)
    .where(eq(fileVersions.siteId, siteId))
    .orderBy(desc(fileVersions.version))
    .limit(1)
    .get();
  return (latest?.version ?? 0) + 1;
}

async function loadActivePages(
  ctx: GenerationContext,
  startedAt: number | null,
): Promise<(typeof pages.$inferSelect)[]> {
  return ctx.db
    .select()
    .from(pages)
    .where(
      and(
        eq(pages.siteId, ctx.siteId),
        eq(pages.status, "active"),
        startedAt === null ? undefined : gte(pages.lastSeenAt, startedAt),
      ),
    )
    .all();
}

function heuristicRender(inventory: Inventory, origin: string): string {
  const content = render(inventory, defaultSummary(inventory));
  const baseCheck = validate(content, origin);
  if (!baseCheck.ok) {
    throw new Error(`generate: heuristic output failed validation: ${baseCheck.errors.join("; ")}`);
  }
  return content;
}

async function refinedRender(
  ctx: GenerationContext,
  inventory: Inventory,
  origin: string,
): Promise<string | null> {
  try {
    const refined = await refine(inventory, ctx.env.ANTHROPIC_API_KEY);
    if (!refined) return null;
    const content = render(refined.inventory, refined.summary);
    const refinedCheck = validate(content, origin);
    if (refinedCheck.ok) return content;
    logWarn("generation_refinement_validation_failed", {
      workflow: "generation",
      step: "llm_refine",
      outcome: "fallback",
      siteId: ctx.siteId,
      runId: ctx.runId,
      errors: refinedCheck.errors,
    });
  } catch (err) {
    captureHandledException(err, {
      workflow: "generation",
      step: "llm_refine",
      outcome: "fallback",
      siteId: ctx.siteId,
      runId: ctx.runId,
    });
    logWarn("generation_refinement_failed", {
      workflow: "generation",
      step: "llm_refine",
      outcome: "fallback",
      siteId: ctx.siteId,
      runId: ctx.runId,
      error: err instanceof Error ? err : new Error(String(err)),
    });
  }
  return null;
}

async function renderGeneration(
  ctx: GenerationContext,
  origin: string,
  startedAt: number | null,
): Promise<RenderedGeneration> {
  const rows = await loadActivePages(ctx, startedAt);
  const inventory = buildInventory(rows, origin);
  const fallback = heuristicRender(inventory, origin);
  const refined = await refinedRender(ctx, inventory, origin);
  return refined === null
    ? { content: fallback, generatedBy: "heuristic" }
    : { content: refined, generatedBy: "llm-refined" };
}

async function publishVersion(
  ctx: GenerationContext,
  rendered: RenderedGeneration,
  changeSummary: string | undefined,
): Promise<GenerationResult> {
  const version = await nextVersion(ctx.db, ctx.siteId);
  const r2Key = `${ctx.siteId}/v${String(version)}.txt`;

  await ctx.env.FILES.put(r2Key, rendered.content, {
    httpMetadata: { contentType: "text/plain; charset=utf-8" },
  });

  await ctx.db.insert(fileVersions).values({
    id: nanoid(12),
    siteId: ctx.siteId,
    runId: ctx.runId,
    version,
    r2Key,
    changeSummary: changeSummary ?? "initial generation",
    generatedBy: rendered.generatedBy,
    createdAt: Math.floor(Date.now() / 1000),
  });

  logInfo("generation_version_published", {
    workflow: "generation",
    step: "publish",
    outcome: "published",
    siteId: ctx.siteId,
    runId: ctx.runId,
    version,
    generatedBy: rendered.generatedBy,
  });
  return { version, r2Key };
}

async function publishWithDuplicateGuard(
  ctx: GenerationContext,
  rendered: RenderedGeneration,
  changeSummary: string | undefined,
): Promise<GenerationResult> {
  try {
    return await publishVersion(ctx, rendered, changeSummary);
  } catch (err) {
    const publishedByDuplicate = await existingGeneration(ctx);
    if (publishedByDuplicate) {
      await finishRun(ctx);
      return publishedByDuplicate;
    }
    throw err;
  }
}

/**
 * Generation entrypoint — the seam between the crawl pipeline and the
 * generator. Called by the crawl-queue "generate" branch once the
 * frontier drains.
 *
 * Contract: idempotent by `runId`; if a file_versions row already exists for
 * the run, returns it and marks the run done without publishing another
 * version. Otherwise reads the page inventory for `siteId` from D1, runs Pass
 * 1 heuristics (always) + Pass 2 LLM refinement (when available), validates
 * the output, writes a versioned blob to R2 ({siteId}/v{n}.txt), inserts a
 * file_versions row, and marks the run done. Never throws on LLM failure —
 * falls back to the heuristic output.
 * @param env Worker bindings that provide D1, R2, and API keys.
 * @param siteId Site whose crawl should be converted into llms.txt.
 * @param runId Crawl run that owns this generation.
 * @param changeSummary Optional persisted summary for the new version row.
 * @returns Published or already-existing version metadata.
 */
export async function generate(
  env: Environment,
  siteId: string,
  runId: string,
  changeSummary?: string,
): Promise<GenerationResult> {
  const db = drizzle(env.DB);
  const ctx: GenerationContext = { db, env, siteId, runId };

  const site = await db.select().from(sites).where(eq(sites.id, siteId)).get();
  if (!site) throw new Error(`generate: site not found: ${siteId}`);

  const alreadyPublished = await existingGeneration(ctx);
  if (alreadyPublished) {
    await finishRun(ctx);
    logInfo("generation_duplicate_skipped", {
      workflow: "generation",
      step: "publish",
      outcome: "already_published",
      siteId,
      runId,
      version: alreadyPublished.version,
    });
    return alreadyPublished;
  }

  const run = await db.select().from(crawlRuns).where(eq(crawlRuns.id, runId)).get();
  if (!run) throw new Error(`generate: run not found: ${runId}`);

  const rendered = await renderGeneration(ctx, site.domain, run.startedAt);
  const publishedDuringGeneration = await existingGeneration(ctx);
  if (publishedDuringGeneration) {
    await finishRun(ctx);
    return publishedDuringGeneration;
  }

  const result = await publishWithDuplicateGuard(ctx, rendered, changeSummary);
  await finishRun(ctx);
  logInfo("generation_completed", {
    workflow: "generation",
    step: "generate",
    outcome: "completed",
    siteId,
    runId,
    version: result.version,
  });
  return result;
}
