# Plan 003: Characterization tests for the SiteCoordinator frontier/budget/mutex

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 66f82d7..HEAD -- apps/api/src/do/site-coordinator.ts`
> If the file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as
> a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `66f82d7`, 2026-06-14
- **Note**: This plan should land **before** plan 004 (the `/complete`
  idempotency fix) so that fix has a regression test to land against.

## Why this matters

`apps/api/src/do/site-coordinator.ts` (190 LOC) is the brain of the crawl: it is
the per-site **mutex** (`claim` rejects a second concurrent run with 409), the
**URL frontier** (`admit` dedupes and enforces `MAX_PAGES`/`MAX_DEPTH`), and the
**drain detector** (`complete` decides when crawling is finished and generation
should start). It has **zero tests**. Every other core module (frontier,
sitemap, robots, validator, heuristics, detect, schedule) has a `.test.ts`; this
one — the highest-coordination-risk file — does not. Characterizing its current
behavior protects the budget cap and the mutex, and is a prerequisite for safely
changing the completion accounting in plan 004.

## Current state

The DO holds an in-memory `State` persisted to `this.ctx.storage` and exposes a
small HTTP-style surface via `fetch(req)` dispatching on `url.pathname`. Key
behaviors to pin (all line numbers in `apps/api/src/do/site-coordinator.ts`):

- **claim** (lines 93-112): rejects with 409 when a _different_ runId is active
  in phase `discovering|crawling|generating`; otherwise resets to a fresh state
  for the new run.
- **seed** (lines 114-120): ignores requests whose `runId` ≠ current; otherwise
  admits the seed URLs and moves to `crawling`.
- **complete** (lines 122-150): ignores foreign `runId` (returns zeros);
  otherwise removes the URL from `inFlight`, increments `pagesCrawled`, admits
  discovered links only when `followLinks && depth < MAX_DEPTH`, and reports
  `drained` when `inFlight` is empty and nothing new was admitted.
- **admit** (lines 160-177): the seam to the pure `acceptUrls` frontier
  (`apps/api/src/crawler/frontier.ts`), with `pageBudget = MAX_PAGES - pagesFound`.

```ts
// site-coordinator.ts:122-142 (the behavior plan 004 will change is line 132-133)
private async complete(body: CompleteRequest): Promise<Response> {
  if (body.runId !== this.state.runId) {
    return Response.json({ accepted: [], drained: false, pagesFound: 0, pagesCrawled: 0 });
  }
  this.state.inFlight = this.state.inFlight.filter((u) => u !== body.url);
  this.state.pagesCrawled++;
  let accepted: { url: string; depth: number }[] = [];
  if (this.state.followLinks && body.links?.length && body.depth < MAX_DEPTH) {
    accepted = this.admit(body.links, body.url, body.depth + 1);
  }
  const drained = this.state.inFlight.length === 0 && accepted.length === 0;
  if (drained) this.state.phase = "generating";
  await this.save();
  // …returns accepted, drained, pagesFound, pagesCrawled
}
```

- **The testability obstacle**: `SiteCoordinator extends DurableObject<Env>`
  and imports from `cloudflare:workers` (line 1). The api package's tests run
  under **plain Node vitest** (`apps/api/package.json:test` → `vitest run`, no
  pool config, no `vitest.config.ts`). Importing `cloudflare:workers` in Node
  may throw. **Step 1 probes this first** and routes the plan accordingly.
- Conventions: tests are plain vitest (`describe`/`it`/`expect`), no heavy
  mocking — see `apps/api/src/crawler/frontier.test.ts` and
  `apps/api/src/queue/crawl-consumer.test.ts` for the in-repo style (small
  hand-rolled fakes, not mocking frameworks).

## Commands you will need

| Purpose   | Command                                                         | Expected on success |
| --------- | --------------------------------------------------------------- | ------------------- |
| Install   | `pnpm install`                                                  | exit 0              |
| Probe     | `pnpm --filter @profound-takehome/api test -- site-coordinator` | see Step 1          |
| Typecheck | `pnpm --filter @profound-takehome/api typecheck`                | exit 0              |
| Tests     | `pnpm --filter @profound-takehome/api test`                     | all pass            |
| Full gate | `pnpm verify`                                                   | exit 0              |

## Scope

**In scope** (the only files you should modify/create):

- `apps/api/src/do/site-coordinator.test.ts` (create) — the characterization tests.
- `apps/api/src/do/site-coordinator.ts` — **only** the minimal refactor in
  Step 2 _if Step 1 proves the DO can't be imported under Node_: extract the
  pure state-transition logic into exported helpers, leaving the class as a thin
  wrapper. No behavior change.

**Out of scope** (do NOT touch):

- `apps/api/src/crawler/frontier.ts` — already tested; `admit` delegates to it.
- `wrangler.toml`, vitest pool configuration, or adding
  `@cloudflare/vitest-pool-workers` — if Node testing is impossible without it,
  that's a STOP (it's a larger infra decision for the operator).
- The completion double-count behavior itself — that is plan 004. Here you
  **characterize current behavior**, even the quirky parts; note them, don't fix.

## Git workflow

- Branch: `advisor/003-site-coordinator-tests`
- Commit style: conventional commits, e.g.
  `test(do): characterize SiteCoordinator claim/seed/complete/admit`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Probe whether the DO is importable under Node vitest

Create `apps/api/src/do/site-coordinator.test.ts` with a single smoke test that
imports the module and constructs the class with a fake DO state:

```ts
import { describe, it, expect } from "vitest";

function fakeStorage() {
  const map = new Map<string, unknown>();
  return {
    get: async (k: string) => map.get(k),
    put: async (k: string, v: unknown) => void map.set(k, v),
  };
}
// Minimal DurableObjectState stand-in: only .storage is used by the class.
function fakeCtx() {
  return { storage: fakeStorage() } as unknown as DurableObjectState;
}

describe("SiteCoordinator (smoke)", () => {
  it("constructs and reports idle status", async () => {
    const { SiteCoordinator } = await import("./site-coordinator");
    const co = new SiteCoordinator(fakeCtx(), {} as never);
    const res = await co.fetch(new Request("https://do/status"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ phase: "idle", pagesFound: 0 });
  });
});
```

Run `pnpm --filter @profound-takehome/api test -- site-coordinator`.

- **If it passes** → the DO is importable under Node. Skip Step 2; go to Step 3
  and test the class directly through its `fetch` surface.
- **If it fails with an import/runtime error from `cloudflare:workers`** (e.g.
  "Cannot find module 'cloudflare:workers'" or `DurableObject is not a
constructor`) → go to Step 2 (refactor for testability). Do **not** try to add
  a Workers vitest pool — that's a STOP.

**Verify**: the smoke test either passes, or fails specifically on the
`cloudflare:workers` import (record which).

### Step 2: (Only if Step 1 failed) Extract pure transition helpers — no behavior change

Refactor `site-coordinator.ts` so the decision logic is in exported pure
functions the class calls, leaving the `cloudflare:workers` surface untestable
but thin. Target shape (names indicative):

```ts
export type State = { /* unchanged shape, move the type export to top level */ };
export const IDLE_STATE: State = { /* unchanged */ };

// Pure: returns the next state + response payload, given current state + request.
export function applyClaim(state: State, body: ClaimRequest): { state: State; status: number; body: unknown } { … }
export function applySeed(state: State, body: SeedRequest): { state: State; body: SeedResponse } { … }
export function applyComplete(state: State, body: CompleteRequest): { state: State; body: CompleteResponse } { … }
export function admitInto(state: State, candidates: string[], baseUrl: string, depth: number): { state: State; accepted: {url:string;depth:number}[] } { … }
```

The class methods become: load state → call the pure fn → assign + `save()` →
return `Response.json(result.body)`. **Preserve current behavior exactly**,
including the `pagesCrawled++` on every `complete` (plan 004 changes that). Keep
`MAX_PAGES`/`MAX_DEPTH` imports from `../crawler/frontier`.

**Verify**: `pnpm --filter @profound-takehome/api typecheck` → exit 0, and the
existing suite still passes (`pnpm --filter @profound-takehome/api test`).

### Step 3: Write the characterization tests

Whether testing via the class `fetch` surface (Step 1 path) or the pure helpers
(Step 2 path), cover these cases. Model the file structure after
`apps/api/src/crawler/frontier.test.ts`.

**Mutex (`claim`)**:

- Fresh coordinator: `claim(runA)` succeeds, phase → `discovering`.
- With `runA` active in `crawling`: `claim(runB)` returns **409** with
  `{ error: "run_in_progress", runId: runA }`.
- With `runA` in terminal phase `done`: `claim(runB)` succeeds (mutex released).

**Seed**:

- `seed` with the wrong runId returns `{ accepted: [] }` and does not change state.
- `seed` with the current runId admits unique same-origin URLs and sets phase
  `crawling`; `pagesFound` equals the accepted count.

**Frontier budget (`admit` via seed)**:

- Seeding more than `MAX_PAGES` (1000) candidates accepts at most the remaining
  budget (`pagesFound` never exceeds `MAX_PAGES`). Use a generated list of
  same-origin URLs (e.g. `https://x.test/p${i}`) so you don't hand-write 1000.
- Duplicate URLs in the seed list are admitted once.

**Drain + depth (`complete`)**:

- Seed one URL, then `complete` it with no links → `drained: true`, phase →
  `generating`, `pagesCrawled === 1`.
- With `followLinks: true` (links discovery mode), `complete` at `depth === MAX_DEPTH`
  admits **no** new links (depth cap), and `complete` at `depth < MAX_DEPTH`
  admits same-origin links.
- `complete` with a foreign runId returns all-zeros and does not mutate state.

**Document-don't-fix**: add a test (or a clearly-commented assertion) that pins
the **current** behavior where calling `complete` twice for the same URL
increments `pagesCrawled` twice. Mark it with a comment:
`// Characterizes current (buggy) double-count; plan 004 changes this.` so plan
004's executor knows to update it.

**Verify**: `pnpm --filter @profound-takehome/api test -- site-coordinator`
→ all new tests pass.

### Step 4: Full gate

**Verify**: `pnpm verify` from repo root → exit 0.

## Test plan

- New file `apps/api/src/do/site-coordinator.test.ts` covering: mutex 409,
  seed admit + foreign-runId no-op, budget cap, dedupe, drain detection, depth
  cap, and the documented double-count quirk.
- Structural pattern: `apps/api/src/crawler/frontier.test.ts` (pure assertions,
  hand-rolled fakes).
- Verification: `pnpm --filter @profound-takehome/api test` → all pass,
  including the new file.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `apps/api/src/do/site-coordinator.test.ts` exists
- [ ] `pnpm --filter @profound-takehome/api test -- site-coordinator` passes with ≥8 assertions across the cases above
- [ ] `pnpm --filter @profound-takehome/api typecheck` exits 0
- [ ] `pnpm verify` exits 0
- [ ] If Step 2 ran: `git diff site-coordinator.ts` shows only a structure-preserving refactor (no changed numeric behavior), confirmed by the still-passing existing suite
- [ ] `git status` shows only in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The smoke test in Step 1 fails for a reason **other** than the
  `cloudflare:workers` import (e.g. the class API differs from the excerpts).
- Making the DO testable appears to _require_ `@cloudflare/vitest-pool-workers`
  or a wrangler/miniflare test environment — that's an infra decision for the
  operator, not this plan.
- The `complete`/`admit`/`claim` source no longer matches the "Current state"
  excerpts.
- A characterization test reveals behavior that contradicts this plan's
  description of current behavior — report it; do not "fix" the code.

## Maintenance notes

- These are **characterization** tests: they pin current behavior, including the
  `pagesCrawled` double-count. Plan 004 will deliberately change that test.
- If Step 2's refactor was needed, future DO logic changes should go in the pure
  helpers so they stay unit-testable without a Workers runtime.
- A reviewer should confirm no behavior changed if Step 2 ran — the existing
  crawl-consumer tests passing unchanged is the signal.
