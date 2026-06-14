# Plan 010 (spike): Wire the provisioned RATE_LIMIT KV to protect the no-auth API

> **Executor instructions**: This is a **design/spike** plan, not a
> build-everything plan. Produce the artifacts in "Deliverables" (a short design
> note + a thin reference implementation behind a flag) and STOP for review
> before hardening. Run the verification commands. If a STOP condition occurs,
> stop and report. When done, update the status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 66f82d7..HEAD -- apps/api/src/app.ts apps/api/src/api/sites.ts apps/api/src/bindings.ts apps/api/wrangler.toml`

## Status

- **Priority**: P3
- **Effort**: M (coarse — design + thin slice)
- **Risk**: MED (a misconfigured limiter can lock out the demo)
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `66f82d7`, 2026-06-14

## Why this matters

The product is intentionally auth-free (observer-first; `docs/PRODUCT.md`
Non-Goals). That makes the **write** endpoint the soft spot: `POST /api/sites`
(`apps/api/src/api/sites.ts:15`) enqueues a crawl run for any URL with no
throttle, so a script can fan out unbounded queued crawls (each spinning a DO,
queue traffic, R2 writes, and an LLM call). A `RATE_LIMIT` KV namespace is
**already provisioned** (`bindings.ts:11`, `wrangler.toml [[kv_namespaces]]`,
README provisioning step) but **nothing reads it** — `grep -rn RATE_LIMIT
apps/api/src | grep -v bindings.ts` returns nothing. Rate-limiting the no-auth
API is consistent with the product model (it's not auth; it's abuse protection)
and uses infrastructure that's already paid for. This spike defines the policy
and lands a thin, flag-gated slice so the operator can decide before it's
enforced.

## Current state

- `apps/api/src/bindings.ts:11` — `RATE_LIMIT: KVNamespace;` declared, unused.
- `apps/api/wrangler.toml` — `[[kv_namespaces]] binding = "RATE_LIMIT"`.
- `apps/api/src/app.ts:9-23` — Hono app; `cors()` on `/api/*` and `/sites/*`;
  routers mounted. No rate-limit middleware.
- `apps/api/src/api/sites.ts:15-51` — `POST /` is the expensive write path
  (insert site + run, enqueue `discover`). Read routes are cheaper.
- Hono middleware convention: `app.use(path, middleware)` (see the `cors()`
  usage in `app.ts`). Handlers are `async (c) => …` returning `c.json(...)`.
- KV supports `get`/`put` with `expirationTtl` — the natural fit for a
  fixed-window counter keyed by client IP. The client IP on Cloudflare is in the
  `CF-Connecting-IP` request header (`c.req.header("cf-connecting-ip")`).

## Deliverables (the point of this spike)

1. **A design note** at `docs/exec-plans/rate-limiting.md` (create) covering:
   - Which routes to limit (recommend: write routes — `POST /api/sites`,
     `PATCH /api/sites/:id/monitoring` — not the public read/file routes), and
     why the hosted-file route is excluded (it's meant to be hammered by proxies;
     Cloudflare edge caching + `cache-control` already shields it).
   - The algorithm (recommend: fixed-window counter in KV: key
     `rl:<route-class>:<ip>:<window>`, `expirationTtl` = window seconds), its
     limits (propose concrete numbers, e.g. N writes / minute / IP), and the
     **failure mode** (recommend fail-open: if KV errors, allow the request —
     never let the limiter take the API down).
   - KV's eventual consistency caveat (counts can undercount under burst across
     edge locations) and why that's acceptable for abuse-protection vs. billing.
   - The response on limit: `429` with a JSON body and a `Retry-After` header.
   - Open questions for the operator (global vs per-route limits, allowlisting,
     whether to also cap by domain being crawled).
2. **A thin reference implementation behind a flag** (see Steps) so the operator
   can review real code, not just prose — but it is **off by default**.

## Commands you will need

| Purpose   | Command                                          | Expected on success |
| --------- | ------------------------------------------------ | ------------------- |
| Typecheck | `pnpm --filter @profound-takehome/api typecheck` | exit 0              |
| Tests     | `pnpm --filter @profound-takehome/api test`      | all pass            |
| Doc check | `pnpm check-docs`                                | exit 0              |
| Full gate | `pnpm verify`                                    | exit 0              |

## Scope

**In scope**:

- `docs/exec-plans/rate-limiting.md` (create) — the design note.
- `apps/api/src/middleware/rate-limit.ts` (create) — a small, tested,
  **fail-open** limiter function + Hono middleware factory.
- `apps/api/src/middleware/rate-limit.test.ts` (create) — unit tests with a fake
  KV.
- `apps/api/src/app.ts` — wire the middleware **gated off by default** (e.g. only
  active when an env flag like `RATE_LIMIT_ENABLED === "1"` is set, read from a
  `wrangler.toml [vars]` entry). Do not turn it on.

**Out of scope** (STOP if you find yourself here):

- Adding auth, API keys, or user accounts (explicit Non-Goal).
- Limiting the public read/file routes.
- Turning the limiter on by default or in production config.
- Per-domain crawl quotas (note as an open question; don't build).

## Git workflow

- Branch: `advisor/010-rate-limit-spike`
- Commit style: conventional commits, e.g.
  `feat(api): flag-gated rate-limit middleware (spike, off by default)`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Write the design note

Create `docs/exec-plans/rate-limiting.md` per "Deliverables" item 1. Keep it to
~1 page. Propose concrete limits but frame them as proposals.

**Verify**: `pnpm check-docs` → exit 0.

### Step 2: Implement a fail-open limiter + tests

Create `apps/api/src/middleware/rate-limit.ts`:

- A pure-ish `checkRateLimit(kv, key, limit, windowS): Promise<{ allowed: boolean; remaining: number }>`
  using `kv.get`/`kv.put` with `expirationTtl`. On any thrown KV error, return
  `{ allowed: true, … }` (fail-open).
- A Hono middleware factory `rateLimit(opts)` that derives the key from
  `cf-connecting-ip` (fallback to a constant when absent), calls `checkRateLimit`,
  and returns `429` + `Retry-After` when not allowed, else `await next()`.

Create `apps/api/src/middleware/rate-limit.test.ts` with a fake KV (a `Map` with
`get`/`put`): under-limit allows; over-limit returns not-allowed; KV throwing →
fail-open allows. Model the test style after
`apps/api/src/crawler/frontier.test.ts`.

**Verify**: `pnpm --filter @profound-takehome/api test -- rate-limit` → all pass.

### Step 3: Wire it OFF by default in app.ts

In `apps/api/src/app.ts`, apply the middleware to the write routes only, gated on
a flag so it is inert unless explicitly enabled:

```ts
// Off by default; operator opts in via RATE_LIMIT_ENABLED=1 (see docs/exec-plans/rate-limiting.md).
if (env-flag is "1") app.use("/api/sites", rateLimit({ limit: …, windowS: … }));
```

Read the flag from the binding/var (add `RATE_LIMIT_ENABLED?: string` to
`bindings.ts` Env and a commented `[vars]` entry in `wrangler.toml` — but leave
it unset so the limiter stays off). Do not change default behavior.

**Verify**: `pnpm --filter @profound-takehome/api test` → all pass (existing
route tests unaffected since the flag is off); `pnpm --filter
@profound-takehome/api typecheck` → exit 0.

### Step 4: Full gate, then STOP for review

**Verify**: `pnpm verify` → exit 0. Then **stop** and report: summarize the
proposed limits and the open questions for the operator to decide before
enabling.

## Done criteria

- [ ] `docs/exec-plans/rate-limiting.md` exists and states routes, algorithm, limits, failure mode, and open questions
- [ ] `apps/api/src/middleware/rate-limit.ts` + test exist; tests cover allow/deny/fail-open
- [ ] The middleware is wired **off by default** (a grep shows it gated on a flag that is unset)
- [ ] `pnpm verify` exits 0; existing route behavior is unchanged with the flag off
- [ ] `git status` shows only in-scope files
- [ ] `plans/README.md` status row updated, and the spike's open questions reported back

## STOP conditions

Stop and report back if:

- Enforcing the limit by default seems necessary to make tests pass (it should
  not — keep it flag-gated).
- The work starts pulling toward auth/API-keys (out of scope, Non-Goal).
- `cf-connecting-ip` is unavailable in the test/runtime in a way that makes
  keying impossible — report and propose an alternative key source.

## Maintenance notes

- Fail-open is deliberate: a limiter that fails-closed can take the whole API
  down on a KV blip. A reviewer should confirm the catch path allows the request.
- KV fixed-window counters are approximate under multi-edge bursts. If precise
  limiting is ever required, evaluate Cloudflare's native Rate Limiting rules or
  a Durable-Object-based limiter — but that's a bigger commitment than this KV is.
- Whoever enables this in production must pick limits with real traffic in mind;
  the spike's numbers are placeholders.
