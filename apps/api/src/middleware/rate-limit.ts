import type { MiddlewareHandler } from "hono";
import type { Env } from "../bindings";

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
};

export async function checkRateLimit(
  kv: KVNamespace,
  key: string,
  limit: number,
  windowS: number
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

export function rateLimit(opts: {
  limit: number;
  windowS: number;
  routeClass: string;
}): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    if (c.env.RATE_LIMIT_ENABLED !== "1") return next();
    if (c.req.method !== "POST" && c.req.method !== "PATCH") return next();

    const ip = c.req.header("cf-connecting-ip") ?? "unknown";
    const window = Math.floor(Date.now() / 1000 / opts.windowS);
    const key = `rl:${opts.routeClass}:${ip}:${window}`;
    const result = await checkRateLimit(c.env.RATE_LIMIT, key, opts.limit, opts.windowS);
    if (!result.allowed) {
      c.header("Retry-After", String(opts.windowS));
      return c.json({ error: "rate_limited" }, 429);
    }
    c.header("X-RateLimit-Remaining", String(result.remaining));
    return next();
  };
}
