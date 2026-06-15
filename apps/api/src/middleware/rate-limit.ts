import type { MiddlewareHandler } from "hono";
import type { Environment } from "../bindings";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

/**
 * Checks and increments a KV-backed fixed-window rate limit counter.
 * @param kv KV namespace that stores counters.
 * @param key Rate limit counter key.
 * @param limit Maximum allowed requests in the window.
 * @param windowS Window length in seconds.
 * @returns Whether the request is allowed and how many requests remain.
 */
export async function checkRateLimit(
  kv: KVNamespace,
  key: string,
  limit: number,
  windowS: number,
): Promise<RateLimitResult> {
  try {
    const raw = await kv.get(key);
    const count = raw ? Number.parseInt(raw, 10) : 0;
    if (Number.isFinite(count) && count >= limit) {
      return { allowed: false, remaining: 0 };
    }
    const next = Number.isFinite(count) ? count + 1 : 1;
    await kv.put(key, String(next), { expirationTtl: windowS });
    return { allowed: true, remaining: Math.max(0, limit - next) };
  } catch {
    return { allowed: true, remaining: limit };
  }
}

/**
 * Creates middleware that rate-limits mutating API requests.
 * @param options Rate limit settings.
 * @param options.limit Maximum allowed requests in the window.
 * @param options.windowS Window length in seconds.
 * @param options.routeClass Stable route bucket used in the KV counter key.
 * @returns Hono middleware for write endpoints.
 */
export function rateLimit(options: {
  limit: number;
  windowS: number;
  routeClass: string;
}): MiddlewareHandler<{ Bindings: Environment }> {
  return async (c, next) => {
    if (c.env.RATE_LIMIT_ENABLED !== "1") return next();
    if (c.req.method !== "POST" && c.req.method !== "PATCH") return next();

    const ip = c.req.header("cf-connecting-ip") ?? "unknown";
    const window = Math.floor(Date.now() / 1000 / options.windowS);
    const key = `rl:${options.routeClass}:${ip}:${String(window)}`;
    const result = await checkRateLimit(c.env.RATE_LIMIT, key, options.limit, options.windowS);
    if (!result.allowed) {
      c.header("Retry-After", String(options.windowS));
      return c.json({ error: "rate_limited" }, 429);
    }
    c.header("X-RateLimit-Remaining", String(result.remaining));
    return next();
  };
}
