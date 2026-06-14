# Plan 005: Tests for the generate() pipeline and the HTTP API routes

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 66f82d7..HEAD -- apps/api/src/generator/index.ts apps/api/src/api/sites.ts apps/api/src/api/jobs.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (independent of 003/004, but shares the D1-faking approach)
- **Category**: tests
- **Planned at**: commit `66f82d7`, 2026-06-14

## Why this matters

`generate()` is the "moment of truth" — it reads the page inventory, runs Pass 1
heuristics + Pass 2 LLM refinement, validates, writes the versioned blob to R2,
and inserts the `file_versions` row. It has **no test**. The two most important
guarantees — **idempotency by `runId`** and **graceful LLM fallback** (any LLM
failure ships Pass 1 output, never throws) — are asserted only in a doc comment
(`generator/index.ts:30-35`). Likewise the HTTP routes in `api/sites.ts`
(create-or-reuse a site, the monitoring toggle) and `api/jobs.ts` (DO status
proxy) are untested; `index.test.ts` only covers `/health`. A regression in the
monitoring toggle or the version-numbering would be silent.

## Current state

### `generate()` — `apps/api/src/generator/index.ts`

- Idempotency (lines 63-67): if a `file_versions` row already exists for this
  `runId`, mark the run done and return it without publishing again.
- LLM fallback (lines 94-112): `refine()` is wrapped in try/catch; a thrown
  error, a `null` result, **or** a refined render that fails `validate()` all
  ship the Pass 1 `content`. Pass 1 itself failing validation **does** throw
  (line 90-92).
- Versioning (lines 120-128): `version = (max existing version) + 1`, R2 key
  `${siteId}/v${version}.txt`.
- Dependencies to fake: `env.DB` (drizzle/D1), `env.FILES` (R2 `.put`),
  `env.ANTHROPIC_API_KEY` (string), and the `refine` import from `./llm`.

### `api/sites.ts` (`sitesRouter`)

- `POST /` (lines 15-51): validates `{ url }` with zod, calls
  `normalizeOrigin`, reuses an existing site row by domain or creates one,
  inserts a `crawl_runs` row (`trigger: "initial"` for new, `"manual"` for
  existing), enqueues a `discover` message, returns `{ siteId, runId }`.
  Invalid/unresolvable URL → 400.
- `PATCH /:id/monitoring` (lines 67-87): zod `{ enabled }`; sets
  `monitoring` 1/0 and `nextCheckAt = enabled ? now + checkIntervalS : null`;
  404 on unknown site.
- `GET /:id`, `/:id/versions`, `/:id/pages`, `/:id/diff`: read paths; 404 on
  unknown site; diff validates the `from`/`to` query as integers ≥1.

### `api/jobs.ts` (`jobsRouter`)

- `GET /:runId` (lines 9-28): 404 if no run; for `crawling`/`generating`
  proxies DO `/status` and returns `{ run, live }`; otherwise `{ run }`.

### Testing approach in this repo

There is no D1 test harness wired. Two viable approaches, pick per Step 1:

1. **Hono app + injected fake bindings** (preferred for routes): construct the
   router and call `app.request(path, init, env)` with a hand-rolled `env`
   whose `DB` is a fake drizzle-like object and `CRAWL_QUEUE.send` is a spy.
   Hono's `app.request` accepts an `env` as the third arg. See
   `apps/api/src/index.test.ts` for how the app is built/tested.
2. **Direct function call with a fake `env`** (preferred for `generate()`):
   call `generate(env, siteId, runId)` with a fake `env`.

Both need a small fake of the drizzle query-builder chain. The existing
`apps/api/src/queue/crawl-consumer.test.ts:112-124` shows the repo's hand-rolled
fake-db style (a `db.update().set().where()` chain returning recorded values).
Extend that pattern to cover `.select().from().where().get()/.all()` and
`.insert().values()`.

## Commands you will need

| Purpose   | Command                                              | Expected on success          |
| --------- | ---------------------------------------------------- | ---------------------------- |
| Probe     | `pnpm --filter @profound-takehome/api test -- index` | existing /health test passes |
| Typecheck | `pnpm --filter @profound-takehome/api typecheck`     | exit 0                       |
| Tests     | `pnpm --filter @profound-takehome/api test`          | all pass                     |
| Full gate | `pnpm verify`                                        | exit 0                       |

## Scope

**In scope** (create these test files; you may add a tiny shared test helper):

- `apps/api/src/generator/index.test.ts` (create)
- `apps/api/src/api/sites.test.ts` (create)
- `apps/api/src/api/jobs.test.ts` (create)
- `apps/api/src/test-helpers.ts` (create, optional) — a reusable fake-D1/fake-env
  builder if it reduces duplication across the three files. Keep it test-only
  (no production imports depend on it).

**Out of scope** (do NOT modify):

- Any production source under `apps/api/src/**`. This is a **tests-only** plan.
  If a function is genuinely untestable without a production change, that's a
  STOP — do not refactor source here.
- `apps/api/src/generator/llm.ts` — mock `refine` at the import boundary with
  `vi.mock`; do not change it.
- The D1 schema, wrangler config, or vitest pool setup.

## Git workflow

- Branch: `advisor/005-generator-api-tests`
- Commit style: conventional commits, e.g.
  `test(api): cover generate() idempotency/fallback and site/job routes`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Choose and prove the faking approach with one route

Write `apps/api/src/api/jobs.test.ts` first (simplest: one route, read-only).
Build the app or router, inject a fake `env` whose `DB` returns a known run row,
and assert:

- unknown runId → 404;
- a `done` run → `{ run }` with no `live`;
- a `crawling` run → `{ run, live }` where `live` comes from a fake
  `SITE_COORDINATOR` stub whose `fetch("https://do/status")` returns a JSON body.

If `app.request(path, init, env)` cleanly injects bindings, use it for the route
tests. If not, call the router's handler directly. Lock the approach here.

**Verify**: `pnpm --filter @profound-takehome/api test -- jobs` → all pass.

### Step 2: Test `sites.ts` create + monitoring toggle

In `apps/api/src/api/sites.test.ts`:

- `POST /` with an invalid URL (`"not a url"`) → 400 `{ error: "invalid_url" }`.
- `POST /` with a private/loopback URL (`"http://127.0.0.1"`) → 400
  `{ error: "unresolvable_url" }` (exercises the `normalizeOrigin` gate).
- `POST /` with a fresh public URL → inserts a site + run with
  `trigger: "initial"`, enqueues a `discover` message (assert the
  `CRAWL_QUEUE.send` spy was called with `{ type: "discover", … }`), returns
  `{ siteId, runId }`.
- `POST /` when the domain already exists → reuses the site id and the run
  `trigger` is `"manual"`.
- `PATCH /:id/monitoring` with `{ enabled: true }` on a known site → sets
  `monitoring: 1` and `nextCheckAt = now + checkIntervalS` (assert the value the
  fake `update().set()` recorded); `{ enabled: false }` → `monitoring: 0`,
  `nextCheckAt: null`.
- `PATCH /:id/monitoring` on an unknown site → 404.

**Verify**: `pnpm --filter @profound-takehome/api test -- sites` → all pass.

### Step 3: Test `generate()` idempotency + fallback

In `apps/api/src/generator/index.test.ts`, `vi.mock("./llm", …)` so `refine`
is controllable. Build a fake `env` with a fake `DB` and a fake `FILES`
(`put` is a spy; `.select` for `file_versions` returns rows you control). Assert:

- **Idempotent**: when a `file_versions` row already exists for the `runId`,
  `generate()` returns that row, marks the run done, and **does not** call
  `FILES.put` (assert spy not called).
- **Fallback on LLM throw**: `refine` rejects → `generate()` still publishes
  (Pass 1 content), `FILES.put` called once, a new `file_versions` row inserted.
- **Fallback on null**: `refine` resolves `null` → same as above (Pass 1).
- **Refinement used when valid**: `refine` returns a valid refined inventory →
  the content written differs from the Pass-1-only render. (Keep the inventory
  small; you control `pages` rows returned by the fake `DB`.)
- **Version increment**: with an existing `version: 2` for the site, the new
  row is `version: 3` and the R2 key is `${siteId}/v3.txt`.

Use real `buildInventory`/`render`/`validate` (they're pure and already tested)
so you only fake the I/O boundaries (`DB`, `FILES`, `refine`).

**Verify**: `pnpm --filter @profound-takehome/api test -- generator/index`
→ all pass.

### Step 4: Full gate

**Verify**: `pnpm verify` from repo root → exit 0.

## Test plan

- `jobs.test.ts`: 404, done-run, active-run-with-live (3 cases).
- `sites.test.ts`: invalid URL, blocked URL, fresh create, existing reuse,
  monitoring on, monitoring off, monitoring 404 (7 cases).
- `generator/index.test.ts`: idempotent return, LLM-throw fallback, LLM-null
  fallback, refinement-applied, version increment (5 cases).
- Structural pattern: hand-rolled fakes per
  `apps/api/src/queue/crawl-consumer.test.ts`; app wiring per
  `apps/api/src/index.test.ts`.
- Verification: `pnpm --filter @profound-takehome/api test` → all pass, ≥15 new
  assertions.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `apps/api/src/generator/index.test.ts`, `apps/api/src/api/sites.test.ts`, `apps/api/src/api/jobs.test.ts` all exist
- [ ] `pnpm --filter @profound-takehome/api test` exits 0 with the new files included
- [ ] The generator test asserts `FILES.put` is NOT called on the idempotent path and IS called once on a fresh publish
- [ ] `pnpm --filter @profound-takehome/api typecheck` exits 0
- [ ] `pnpm verify` exits 0
- [ ] `git status` shows only new test files (and the optional `test-helpers.ts`) — no production source changed
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `generate()` or the routers can't be exercised without modifying production
  source (e.g. a binding is read in a way the fake can't satisfy) — report what
  blocks it rather than refactoring source.
- `app.request(path, init, env)` does not inject the fake bindings and there is
  no clean way to call the handlers directly.
- The "Current state" excerpts no longer match the source.
- A new test reveals a real bug (e.g. `generate()` _does_ throw on LLM failure
  contrary to its contract) — report it as a finding; do not fix source in this
  tests-only plan.

## Maintenance notes

- These tests fake the D1/R2 boundary. If the project later adopts
  `@cloudflare/vitest-pool-workers` with a real local D1, these can be
  simplified to use the real binding — keep the assertions, swap the fakes.
- A reviewer should check the fallback assertions specifically: the product
  guarantee is "LLM never breaks generation", so the throw/null/invalid-refine
  cases are the ones that matter most.
- If a future change makes Pass 1 output able to fail validation under normal
  input, the "Pass 1 failing throws" branch (index.ts:90-92) needs its own test.
