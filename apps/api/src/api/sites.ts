import { Hono } from "hono";
import { z } from "zod";
import { nanoid } from "nanoid";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq, inArray } from "drizzle-orm";
import { sites, crawlRuns, pages, fileVersions } from "@profound-takehome/db";
import type { Env } from "../bindings";
import { normalizeOrigin } from "../lib/url";
import { unifiedDiff } from "./files";

export const sitesRouter = new Hono<{ Bindings: Env }>();

const createBody = z.object({ url: z.string().url() });

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
      monitoring: 0,
      checkIntervalS: 86400,
      changeStreak: 0,
      createdAt: now,
    });
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

  return c.json({ siteId, runId });
});

sitesRouter.get("/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const site = await db.select().from(sites).where(eq(sites.id, c.req.param("id"))).get();
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
  const site = await db.select().from(sites).where(eq(sites.id, c.req.param("id"))).get();
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
  return c.json({ site: updated });
});

sitesRouter.get("/:id/versions", async (c) => {
  const db = drizzle(c.env.DB);
  const site = await db.select().from(sites).where(eq(sites.id, c.req.param("id"))).get();
  if (!site) return c.json({ error: "not_found" }, 404);
  const versions = await db
    .select()
    .from(fileVersions)
    .where(eq(fileVersions.siteId, site.id))
    .orderBy(desc(fileVersions.version));
  return c.json({ versions });
});

sitesRouter.get("/:id/pages", async (c) => {
  const db = drizzle(c.env.DB);
  const site = await db.select().from(sites).where(eq(sites.id, c.req.param("id"))).get();
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
    .where(eq(pages.siteId, site.id))
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
  const site = await db.select().from(sites).where(eq(sites.id, c.req.param("id"))).get();
  if (!site) return c.json({ error: "not_found" }, 404);

  const rows = await db
    .select()
    .from(fileVersions)
    .where(and(eq(fileVersions.siteId, site.id), inArray(fileVersions.version, [from, to])));
  const fromRow = rows.find((r) => r.version === from);
  const toRow = rows.find((r) => r.version === to);
  if (!fromRow || !toRow) return c.json({ error: "version_not_found" }, 404);

  const [fromObj, toObj] = await Promise.all([
    c.env.FILES.get(fromRow.r2Key),
    c.env.FILES.get(toRow.r2Key),
  ]);
  if (!fromObj || !toObj) return c.json({ error: "file_missing" }, 500);

  const [fromText, toText] = await Promise.all([fromObj.text(), toObj.text()]);
  const diff = unifiedDiff(fromText, toText, `llms.txt v${from}`, `llms.txt v${to}`);
  return c.json({ from, to, diff });
});
