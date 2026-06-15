import { createMiddleware } from "hono/factory";
import type { MiddlewareHandler } from "hono";
import type { Environment } from "../bindings";
import { logError, logInfo } from "./logger";

function requestId(headers: Headers): string {
  return headers.get("cf-ray") ?? crypto.randomUUID();
}

/**
 * Log completed and failed HTTP requests with stable Cloudflare-queryable fields.
 *
 * @returns Hono middleware for all Worker HTTP routes.
 */
export function requestLogger(): MiddlewareHandler<{ Bindings: Environment }> {
  return createMiddleware<{ Bindings: Environment }>(async (c, next) => {
    const started = Date.now();
    const id = requestId(c.req.raw.headers);

    try {
      await next();
      logInfo("http_request_completed", {
        workflow: "http",
        step: "request",
        outcome: "completed",
        requestId: id,
        method: c.req.method,
        route: c.req.path,
        status: c.res.status,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      logError("http_request_failed", {
        workflow: "http",
        step: "request",
        outcome: "failed",
        requestId: id,
        method: c.req.method,
        route: c.req.path,
        durationMs: Date.now() - started,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  });
}
