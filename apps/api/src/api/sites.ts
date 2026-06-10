import { Hono } from "hono";
import { z } from "zod";
import { nanoid } from "nanoid";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { sites, crawlRuns } from "@profound-takehome/db";
import type { Env } from "../bindings";
import { normalizeOrigin } from "../lib/url";

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
  return c.json({ site });
});
