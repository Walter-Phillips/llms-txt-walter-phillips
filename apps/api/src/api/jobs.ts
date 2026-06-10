import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { crawlRuns } from "@profound-takehome/db";
import type { Env } from "../bindings";

export const jobsRouter = new Hono<{ Bindings: Env }>();

jobsRouter.get("/:runId", async (c) => {
  const db = drizzle(c.env.DB);
  const run = await db
    .select()
    .from(crawlRuns)
    .where(eq(crawlRuns.id, c.req.param("runId")))
    .get();
  if (!run) return c.json({ error: "not_found" }, 404);

  // Live progress comes from the DO when a run is mid-flight; D1 is the
  // durable record once it settles. We proxy DO state for active runs.
  if (run.status === "crawling" || run.status === "generating") {
    const id = c.env.SITE_COORDINATOR.idFromName(run.siteId);
    const stub = c.env.SITE_COORDINATOR.get(id);
    const live = await stub.fetch("https://do/status").then((r) => r.json());
    return c.json({ run, live });
  }

  return c.json({ run });
});
