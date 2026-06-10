import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq } from "drizzle-orm";
import { sites, fileVersions } from "@profound-takehome/db";
import type { Env } from "../bindings";

export const filesRouter = new Hono<{ Bindings: Env }>();

// Public: GET /sites/:domain/llms.txt → latest file for a registered domain.
filesRouter.get("/:domain/llms.txt", async (c) => {
  const db = drizzle(c.env.DB);
  const site = await db.select().from(sites).where(eq(sites.domain, c.req.param("domain"))).get();
  if (!site) return c.text("not found", 404);

  const latest = await db
    .select()
    .from(fileVersions)
    .where(eq(fileVersions.siteId, site.id))
    .orderBy(desc(fileVersions.version))
    .limit(1)
    .get();
  if (!latest) return c.text("not generated yet", 404);

  const obj = await c.env.FILES.get(latest.r2Key);
  if (!obj) return c.text("file missing", 500);

  return new Response(obj.body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=300",
      "x-llms-txt-version": String(latest.version),
    },
  });
});

filesRouter.get("/:domain/versions", async (c) => {
  const db = drizzle(c.env.DB);
  const site = await db.select().from(sites).where(eq(sites.domain, c.req.param("domain"))).get();
  if (!site) return c.json({ error: "not_found" }, 404);
  const versions = await db
    .select()
    .from(fileVersions)
    .where(eq(fileVersions.siteId, site.id))
    .orderBy(desc(fileVersions.version));
  return c.json({ versions });
});

// Suppress unused-import warning for `and` until version diff route lands.
void and;
