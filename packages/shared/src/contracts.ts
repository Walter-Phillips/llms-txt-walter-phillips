import { z } from "zod";

/**
 * Frozen cross-stream contracts. Streams A (crawl), B (generation),
 * C (UI), D (monitoring), E (LLM) all code against these shapes.
 * Changing anything here requires coordinating across streams — prefer
 * additive changes.
 */

// ---------------------------------------------------------------------------
// Run / job lifecycle
// ---------------------------------------------------------------------------

export const runStatusSchema = z.enum(["queued", "crawling", "generating", "done", "error"]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const phaseSchema = z.enum([
  "idle",
  "discovering",
  "crawling",
  "generating",
  "done",
  "error",
]);
export type Phase = z.infer<typeof phaseSchema>;

export const discoveryMethodSchema = z.enum(["sitemap", "links", "rendered"]);
export type DiscoveryMethod = z.infer<typeof discoveryMethodSchema>;

/** Live snapshot served by SiteCoordinator DO at GET /status. */
export const liveStatusSchema = z.object({
  runId: z.string().nullable(),
  phase: phaseSchema,
  pagesFound: z.number(),
  pagesCrawled: z.number(),
  discoveryMethod: z.string().nullable(),
  frontierSize: z.number(),
  inFlight: z.number(),
});
export type LiveStatus = z.infer<typeof liveStatusSchema>;

// ---------------------------------------------------------------------------
// API serializations (D1 rows as returned by the Hono routes)
// ---------------------------------------------------------------------------

export const siteSchema = z.object({
  id: z.string(),
  domain: z.string(),
  displayName: z.string().nullable(),
  monitoring: z.number(),
  checkIntervalS: z.number(),
  nextCheckAt: z.number().nullable(),
  changeStreak: z.number(),
  createdAt: z.number(),
});
export type Site = z.infer<typeof siteSchema>;

export const runSchema = z.object({
  id: z.string(),
  siteId: z.string(),
  trigger: z.string(),
  status: runStatusSchema,
  pagesFound: z.number(),
  pagesCrawled: z.number(),
  pagesChanged: z.number(),
  discoveryMethod: z.string().nullable(),
  error: z.string().nullable(),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
});
export type Run = z.infer<typeof runSchema>;

export const fileVersionSchema = z.object({
  id: z.string(),
  siteId: z.string(),
  runId: z.string().nullable(),
  version: z.number(),
  r2Key: z.string(),
  changeSummary: z.string().nullable(),
  createdAt: z.number(),
});
export type FileVersion = z.infer<typeof fileVersionSchema>;

export const pageInventoryItemSchema = z.object({
  url: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  sectionHint: z.string().nullable(),
  status: z.string(),
});
export type PageInventoryItem = z.infer<typeof pageInventoryItemSchema>;

// ---------------------------------------------------------------------------
// API request/response shapes
// ---------------------------------------------------------------------------

export const createSiteResponseSchema = z.object({ siteId: z.string(), runId: z.string() });
export type CreateSiteResponse = z.infer<typeof createSiteResponseSchema>;

export const jobStatusResponseSchema = z.object({
  run: runSchema,
  live: liveStatusSchema.optional(),
});
export type JobStatusResponse = z.infer<typeof jobStatusResponseSchema>;

export const siteResponseSchema = z.object({
  site: siteSchema,
  latestVersion: fileVersionSchema.nullable().optional(),
});
export type SiteResponse = z.infer<typeof siteResponseSchema>;

export const versionsResponseSchema = z.object({ versions: z.array(fileVersionSchema) });
export type VersionsResponse = z.infer<typeof versionsResponseSchema>;

export const pagesResponseSchema = z.object({ pages: z.array(pageInventoryItemSchema) });
export type PagesResponse = z.infer<typeof pagesResponseSchema>;

export const diffResponseSchema = z.object({
  from: z.number(),
  to: z.number(),
  diff: z.string(), // unified diff text
});
export type DiffResponse = z.infer<typeof diffResponseSchema>;

export const apiErrorSchema = z.object({ error: z.string() });
export type ApiError = z.infer<typeof apiErrorSchema>;

// ---------------------------------------------------------------------------
// Generator inventory (Pass 1 output, Pass 2 LLM input)
// ---------------------------------------------------------------------------

export const inventoryPageSchema = z.object({
  url: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  h1: z.string().nullable(),
  sectionHint: z.string().nullable(),
});
export type InventoryPage = z.infer<typeof inventoryPageSchema>;

export const sectionInventorySchema = z.object({
  name: z.string(),
  pages: z.array(inventoryPageSchema),
});
export type SectionInventory = z.infer<typeof sectionInventorySchema>;

export const inventorySchema = z.object({
  siteName: z.string(),
  origin: z.string(),
  homepageSnippet: z.string().nullable(),
  sections: z.array(sectionInventorySchema),
  optional: z.array(inventoryPageSchema),
});
export type Inventory = z.infer<typeof inventorySchema>;

// ---------------------------------------------------------------------------
// Monitoring
// ---------------------------------------------------------------------------

export const changeSetSchema = z.object({
  added: z.array(z.string()),
  removed: z.array(z.string()),
  modified: z.array(z.string()),
});
export type ChangeSet = z.infer<typeof changeSetSchema>;

export function summarizeChanges(c: ChangeSet): string {
  const parts: string[] = [];
  if (c.added.length) parts.push(`${c.added.length} page${c.added.length === 1 ? "" : "s"} added`);
  if (c.removed.length)
    parts.push(`${c.removed.length} page${c.removed.length === 1 ? "" : "s"} removed`);
  if (c.modified.length)
    parts.push(`${c.modified.length} page${c.modified.length === 1 ? "" : "s"} modified`);
  return parts.length ? parts.join(", ") : "no changes";
}
