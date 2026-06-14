import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Env } from "../bindings";
import { checkRateLimit, rateLimit } from "./rate-limit";

function fakeKv(opts: { throws?: boolean } = {}): KVNamespace {
  const map = new Map<string, string>();
  return {
    get: async (key: string) => {
      if (opts.throws) throw new Error("kv unavailable");
      return map.get(key) ?? null;
    },
    put: async (key: string, value: string) => {
      if (opts.throws) throw new Error("kv unavailable");
      map.set(key, value);
    },
  } as unknown as KVNamespace;
}

function env(kv = fakeKv(), enabled = "1"): Env {
  return { RATE_LIMIT: kv, RATE_LIMIT_ENABLED: enabled } as unknown as Env;
}

describe("checkRateLimit", () => {
  it("allows requests under the limit", async () => {
    const kv = fakeKv();

    await expect(checkRateLimit(kv, "k", 2, 60)).resolves.toEqual({ allowed: true, remaining: 1 });
    await expect(checkRateLimit(kv, "k", 2, 60)).resolves.toEqual({ allowed: true, remaining: 0 });
  });

  it("denies requests over the limit", async () => {
    const kv = fakeKv();
    await checkRateLimit(kv, "k", 1, 60);

    await expect(checkRateLimit(kv, "k", 1, 60)).resolves.toEqual({ allowed: false, remaining: 0 });
  });

  it("fails open when KV throws", async () => {
    await expect(checkRateLimit(fakeKv({ throws: true }), "k", 1, 60)).resolves.toEqual({
      allowed: true,
      remaining: 1,
    });
  });
});

describe("rateLimit", () => {
  it("returns 429 with Retry-After when enabled and over limit", async () => {
    const app = new Hono<{ Bindings: Env }>();
    const bindings = env();
    app.use(rateLimit({ limit: 1, windowS: 60, routeClass: "write" }));
    app.post("/", (c) => c.json({ ok: true }));

    const first = await app.request("/", { method: "POST" }, bindings);
    expect(first.status).toBe(200);

    const second = await app.request("/", { method: "POST" }, bindings);
    expect(second.status).toBe(429);
    expect(second.headers.get("Retry-After")).toBe("60");
    expect(await second.json()).toEqual({ error: "rate_limited" });
  });

  it("is inert when the flag is disabled", async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.use(rateLimit({ limit: 0, windowS: 60, routeClass: "write" }));
    app.post("/", (c) => c.json({ ok: true }));

    const res = await app.request("/", { method: "POST" }, env(fakeKv(), "0"));
    expect(res.status).toBe(200);
  });
});
