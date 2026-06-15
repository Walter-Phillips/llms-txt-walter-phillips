import { Hono } from "hono";
import { z } from "zod";
import { nanoid } from "nanoid";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq, like } from "drizzle-orm";
import { sites, crawlRuns, pages, fileVersions } from "@profound-takehome/db";
import type { Environment } from "../bindings";
import { normalizeOrigin } from "../lib/url";
import { logInfo } from "../observability/logger";
import { computeDiff, listVersions } from "./files";

export const sitesRouter = new Hono<{ Bindings: Environment }>();

const createBody = z.object({ url: z.string().url() });
interface GeneratedSiteRow {
  site: typeof sites.$inferSelect;
  latestVersion: typeof fileVersions.$inferSelect;
}

function normalizeSearchQuery(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const origin = normalizeOrigin(withScheme);
  if (origin) return new URL(origin).hostname;
  return trimmed
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

sitesRouter.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const query = normalizeSearchQuery(c.req.query("query") ?? "");
  const siteRows = query
    ? await db
        .select()
        .from(sites)
        .where(like(sites.domain, `%${query}%`))
        .orderBy(desc(sites.createdAt))
        .limit(50)
    : await db.select().from(sites).orderBy(desc(sites.createdAt)).limit(50);

  const generated: GeneratedSiteRow[] = [];
  for (const site of siteRows) {
    const latestVersion = await db
      .select()
      .from(fileVersions)
      .where(eq(fileVersions.siteId, site.id))
      .orderBy(desc(fileVersions.version))
      .limit(1)
      .get();
    if (latestVersion) generated.push({ site, latestVersion });
  }

  generated.sort((a, b) => b.latestVersion.createdAt - a.latestVersion.createdAt);
  return c.json({ sites: generated });
});

sitesRouter.post("/", async (c) => {
  const parsed = createBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_url" }, 400);

  const origin = normalizeOrigin(parsed.data.url);
  if (!origin) return c.json({ error: "unresolvable_url" }, 400);

  const db = drizzle(c.env.DB);
  const now = Math.floor(Date.now() / 1000);

  const existing = await db.select().from(sites).where(eq(sites.domain, origin)).get();
  const siteId = existing?.id ?? nanoid(12);

  if (!existing) {
    await db.insert(sites).values({
      id: siteId,
      domain: origin,
      monitoring: 1,
      checkIntervalS: 86400,
      nextCheckAt: now + 86400,
      changeStreak: 0,
      createdAt: now,
    });
  } else if (existing.monitoring !== 1) {
    await db
      .update(sites)
      .set({
        monitoring: 1,
        nextCheckAt: now + existing.checkIntervalS,
      })
      .where(eq(sites.id, existing.id));
  }

  const runId = nanoid(12);
  await db.insert(crawlRuns).values({
    id: runId,
    siteId,
    trigger: existing ? "manual" : "initial",
    status: "queued",
    startedAt: now,
  });

  await c.env.CRAWL_QUEUE.send({ type: "discover", runId, siteId, url: origin });
  logInfo("crawl_run_queued", {
    workflow: "crawl",
    step: "api_enqueue",
    outcome: "queued",
    trigger: existing ? "manual" : "initial",
    siteId,
    runId,
    domain: origin,
  });

  return c.json({ siteId, runId });
});

sitesRouter.get("/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const site = await db
    .select()
    .from(sites)
    .where(eq(sites.id, c.req.param("id")))
    .get();
  if (!site) return c.json({ error: "not_found" }, 404);
  const latestVersion = await db
    .select()
    .from(fileVersions)
    .where(eq(fileVersions.siteId, site.id))
    .orderBy(desc(fileVersions.version))
    .limit(1)
    .get();
  return c.json({ site, latestVersion: latestVersion ?? null });
});

sitesRouter.patch("/:id/monitoring", async (c) => {
  const body = z.object({ enabled: z.boolean() }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_body" }, 400);

  const db = drizzle(c.env.DB);
  const site = await db
    .select()
    .from(sites)
    .where(eq(sites.id, c.req.param("id")))
    .get();
  if (!site) return c.json({ error: "not_found" }, 404);

  const now = Math.floor(Date.now() / 1000);
  await db
    .update(sites)
    .set({
      monitoring: body.data.enabled ? 1 : 0,
      // First check after the current interval; the cadence loop adapts from there.
      nextCheckAt: body.data.enabled ? now + site.checkIntervalS : null,
    })
    .where(eq(sites.id, site.id));

  const updated = await db.select().from(sites).where(eq(sites.id, site.id)).get();
  logInfo("monitoring_toggled", {
    workflow: "monitor",
    step: "toggle",
    outcome: "updated",
    siteId: site.id,
    domain: site.domain,
    enabled: body.data.enabled,
  });
  return c.json({ site: updated });
});

sitesRouter.get("/:id/versions", async (c) => {
  const db = drizzle(c.env.DB);
  const site = await db
    .select()
    .from(sites)
    .where(eq(sites.id, c.req.param("id")))
    .get();
  if (!site) return c.json({ error: "not_found" }, 404);
  return listVersions(c, db, site);
});

sitesRouter.get("/:id/pages", async (c) => {
  const db = drizzle(c.env.DB);
  const site = await db
    .select()
    .from(sites)
    .where(eq(sites.id, c.req.param("id")))
    .get();
  if (!site) return c.json({ error: "not_found" }, 404);
  const rows = await db
    .select({
      url: pages.url,
      title: pages.title,
      description: pages.description,
      sectionHint: pages.sectionHint,
      status: pages.status,
    })
    .from(pages)
    .where(and(eq(pages.siteId, site.id), eq(pages.status, "active")))
    .orderBy(pages.url);
  return c.json({ pages: rows });
});

sitesRouter.get("/:id/diff", async (c) => {
  const from = Number.parseInt(c.req.query("from") ?? "", 10);
  const to = Number.parseInt(c.req.query("to") ?? "", 10);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < 1) {
    return c.json({ error: "invalid_version_range" }, 400);
  }

  const db = drizzle(c.env.DB);
  const site = await db
    .select()
    .from(sites)
    .where(eq(sites.id, c.req.param("id")))
    .get();
  if (!site) return c.json({ error: "not_found" }, 404);

  return computeDiff(c, db, site, { from, to });
});
