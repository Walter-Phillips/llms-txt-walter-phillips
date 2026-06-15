import { Hono } from "hono";
import { cors } from "hono/cors";
import { healthResponseSchema } from "@profound-takehome/shared";
import type { Environment } from "./bindings";
import { sitesRouter } from "./api/sites";
import { jobsRouter } from "./api/jobs";
import { filesRouter } from "./api/files";
import { rateLimit } from "./middleware/rate-limit";
import { requestLogger } from "./observability/request-logger";

/**
 * Builds the Hono app with middleware and API routes.
 *
 * @returns Configured API application.
 */
export function buildApp(): Hono<{ Bindings: Environment }> {
  const app = new Hono<{ Bindings: Environment }>();

  app.use("*", requestLogger());
  app.use("/api/*", cors());
  // The hosted file is public and meant to be fetched cross-origin (UI, proxies).
  app.use("/sites/*", cors());
  const writeRateLimit = rateLimit({ limit: 10, windowS: 60, routeClass: "write" });
  app.use("/api/sites", writeRateLimit);
  app.use("/api/sites/*", writeRateLimit);

  app.get("/health", (c) => c.json(healthResponseSchema.parse({ status: "ok" })));

  app.route("/api/sites", sitesRouter);
  app.route("/api/jobs", jobsRouter);
  app.route("/sites", filesRouter);

  return app;
}

export const app = buildApp();
