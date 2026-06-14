import { Hono } from "hono";
import { cors } from "hono/cors";
import { healthResponseSchema } from "@profound-takehome/shared";
import type { Env } from "./bindings";
import { sitesRouter } from "./api/sites";
import { jobsRouter } from "./api/jobs";
import { filesRouter } from "./api/files";

export function buildApp() {
  const app = new Hono<{ Bindings: Env }>();

  app.use("/api/*", cors());
  // The hosted file is public and meant to be fetched cross-origin (UI, proxies).
  app.use("/sites/*", cors());

  app.get("/health", (c) => c.json(healthResponseSchema.parse({ status: "ok" })));

  app.route("/api/sites", sitesRouter);
  app.route("/api/jobs", jobsRouter);
  app.route("/sites", filesRouter);

  return app;
}

export const app = buildApp();
