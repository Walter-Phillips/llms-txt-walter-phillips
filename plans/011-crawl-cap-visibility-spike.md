# Plan 011 (spike): Surface crawl-cap reasons so users know when a crawl was truncated

> **Executor instructions**: This is a **design/spike** plan. Produce the design
> note and a thin, end-to-end-typed slice, then STOP for review. Run the
> verification commands. If a STOP condition occurs, stop and report. When done,
> update the status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 66f82d7..HEAD -- apps/api/src/crawler/frontier.ts apps/api/src/do/site-coordinator.ts apps/api/src/queue/crawl-consumer.ts packages/db/src/schema.ts packages/shared/src/contracts.ts apps/web/src/components/result-view.tsx`

## Status

- **Priority**: P3
- **Effort**: M (coarse — touches DB, DO, contracts, UI)
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `66f82d7`, 2026-06-14

## Why this matters

The crawl is bounded by design (`MAX_PAGES = 1000`, `MAX_DEPTH = 3` in
`apps/api/src/crawler/frontier.ts`; Non-Goal: "Crawling at search-engine
depth"). That's correct — but it's **silent**. A user who submits a 10,000-page
docs site gets an llms.txt covering 1,000 pages with no indication the crawl was
capped, why, or what was left out. The page-inventory table
(`apps/web/src/components/result-view.tsx` / `page-inventory.tsx`) shows what
*was* crawled but not that more *existed*. Surfacing a cap reason turns a
confusing silent truncation into an honest "limited to 1,000 pages (site is
larger)" signal — building trust in a product whose whole pitch is an accurate,
maintained file. This spike designs the data flow and lands a typed slice.

## Current state

- `apps/api/src/crawler/frontier.ts:6-7` — `MAX_PAGES = 1_000`, `MAX_DEPTH = 3`.
  `acceptUrls` (lines 32-59) stops admitting at `pageBudget` but returns no
  signal about *why* it stopped.
- `apps/api/src/do/site-coordinator.ts:160-177` — `admit` computes
  `pageBudget = Math.max(0, MAX_PAGES - pagesFound)`; when the budget hits 0,
  further candidates are silently dropped. The DO knows `pagesFound` vs.
  candidate volume but records no cap flag.
- `apps/api/src/queue/crawl-consumer.ts:255-262` — the only existing "why did the
  crawl end this way" signal is the `"no crawlable pages found"` error. There is
  no positive "capped" signal.
- `crawl_runs` table (`packages/db/src/schema.ts:47-68`) has `pagesFound`,
  `pagesCrawled`, `discoveryMethod`, `error` — but no `cap_reason` field.
- `packages/shared/src/contracts.ts` — zod response contracts shared by API +
  web; the job/site responses flow to the UI through here.
- `apps/web/src/components/result-view.tsx` — renders the result, including the
  hosted URL and inventory. The place a cap badge would live.

## Deliverables

1. **A design note** at `docs/exec-plans/crawl-cap-visibility.md` (create):
   - The set of cap reasons worth distinguishing: `max_pages` (frontier budget
     exhausted while candidates remained), `max_depth` (links existed past depth
     3 — optional, may be noisy), and "none" (crawl covered everything found).
     Recommend starting with **`max_pages` only** — it's the one users hit and
     can act on; `max_depth` is murkier (depth-capped links are often
     low-value). Justify the choice.
   - Where the signal is detected (the DO `admit`, which sees budget-vs-candidates)
     and how it propagates: DO state → `CompleteResponse`/run update →
     `crawl_runs.cap_reason` → shared contract → job/site response → UI badge.
   - The migration + schema change required.
   - Open questions: do we count *how many* pages were skipped (needs the DO to
     track dropped candidates) or just a boolean reason? Recommend the simpler
     reason-only first.
2. **A thin typed slice** proving the data path end-to-end for `max_pages`:
   schema field + migration, DO sets the reason when budget is exhausted, run
   row carries it, contract exposes it, and the result view reads it. Keep the UI
   change minimal (a single badge/line), and keep `max_depth` out of the first
   slice unless trivial.

## Commands you will need

| Purpose          | Command                                          | Expected on success |
|------------------|--------------------------------------------------|---------------------|
| API typecheck    | `pnpm --filter @profound-takehome/api typecheck` | exit 0              |
| DB typecheck     | `pnpm --filter @profound-takehome/db typecheck`  | exit 0              |
| Web typecheck    | `pnpm --filter @profound-takehome/web typecheck` | exit 0              |
| Tests            | `pnpm test`                                      | all pass            |
| Doc check        | `pnpm check-docs`                                | exit 0              |
| Full gate        | `pnpm verify`                                    | exit 0              |

## Scope

**In scope** (thin slice):
- `docs/exec-plans/crawl-cap-visibility.md` (create).
- `packages/db/src/schema.ts` — add `capReason: text("cap_reason")` (nullable) to `crawl_runs`.
- `packages/db/migrations/00NN_crawl_cap_reason.sql` (create) — `ALTER TABLE crawl_runs ADD COLUMN cap_reason TEXT;` (use the next free migration number).
- `apps/api/src/do/site-coordinator.ts` — detect budget exhaustion in `admit`/`complete` and expose it (e.g. a `capped: boolean` on `CompleteResponse`/state).
- `apps/api/src/queue/crawl-consumer.ts` — persist `cap_reason = "max_pages"` on the run when the DO reports capping.
- `packages/shared/src/contracts.ts` — add the optional `capReason` to the relevant response schema.
- `apps/web/src/components/result-view.tsx` — render a small "limited to N pages" note when `capReason === "max_pages"`.
- Tests: extend the DO test (plan 003) and a shared-contract test for the new field.

**Out of scope** (STOP if pulled here):
- Raising or making `MAX_PAGES`/`MAX_DEPTH` user-configurable (that's a Non-Goal
  direction — note as an open question, don't build).
- `max_depth` and `robots_disallow` reasons in the first slice (mention in the
  doc; defer).
- Counting exact skipped-page totals (needs extra DO bookkeeping — open question).

## Git workflow

- Branch: `advisor/011-crawl-cap-visibility`
- Commit style: conventional commits, e.g.
  `feat: surface max_pages crawl cap to the result view (spike)`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Write the design note

Create `docs/exec-plans/crawl-cap-visibility.md` per Deliverables item 1.

**Verify**: `pnpm check-docs` → exit 0.

### Step 2: Schema + migration for `cap_reason`

Add the nullable column to `crawl_runs` in `schema.ts` and a matching
`ALTER TABLE crawl_runs ADD COLUMN cap_reason TEXT;` migration (next free number
after the highest existing in `packages/db/migrations/`). Match the style of
`0001_run_change_summary.sql`.

**Verify**: `pnpm --filter @profound-takehome/db typecheck` → exit 0.

### Step 3: Detect + propagate `max_pages` in the DO and consumer

In the DO, set a `capped` signal when `admit` drops candidates because
`pageBudget` reached 0 with candidates still pending (i.e. input candidates >
accepted due to budget, not due to dedupe/filtering). Surface it on the
completion response/state. In `crawl-consumer.ts`, when the DO reports capping
at drain time, set `cap_reason: "max_pages"` on the `crawl_runs` update that
already runs at `completion.drained` (lines 369-377). Keep the change additive.

**Verify**: `pnpm --filter @profound-takehome/api typecheck` → exit 0; DO tests
(plan 003) extended to assert the `capped` signal when seeding > MAX_PAGES.

### Step 4: Contract + UI

Add optional `capReason` to the appropriate response in
`packages/shared/src/contracts.ts` (and a contract test in
`packages/shared/src/index.test.ts`). In `result-view.tsx`, render a one-line
note when `capReason === "max_pages"` (e.g. "Crawl limited to 1,000 pages — this
site is larger."). Keep it minimal and accessible.

**Verify**: `pnpm --filter @profound-takehome/web typecheck` → exit 0;
`pnpm test` → all pass.

### Step 5: Full gate, then STOP for review

**Verify**: `pnpm verify` → exit 0. Then **stop** and report the open questions
(skipped-count vs boolean; whether to add `max_depth`).

## Done criteria

- [ ] `docs/exec-plans/crawl-cap-visibility.md` exists with reasons, data flow, and open questions
- [ ] `crawl_runs.cap_reason` exists in `schema.ts` and a matching migration
- [ ] DO reports a cap signal when budget is exhausted; covered by a test
- [ ] `capReason` flows through the shared contract to `result-view.tsx`
- [ ] `pnpm verify` exits 0
- [ ] `git status` shows only in-scope files
- [ ] `plans/README.md` status row updated and open questions reported

## STOP conditions

Stop and report back if:
- Distinguishing "capped by budget" from "fewer candidates than budget" turns
  out to require more DO bookkeeping than a boolean (report; propose the smaller
  version).
- The change to `CompleteResponse` ripples into more than the consumer + DO test
  (it shouldn't).
- The work drifts toward making caps user-configurable (Non-Goal).

## Maintenance notes

- Start with `max_pages` only. Adding `max_depth`/`robots_disallow` later is
  additive (same column, more values) — but verify each is *actionable* to the
  user before surfacing it; noise erodes trust as much as silence.
- A reviewer should confirm the cap detection doesn't misfire on normal small
  crawls (a 5-page site must report no cap).
- If `MAX_PAGES` ever becomes configurable per-site, the UI copy must read the
  actual cap, not the hardcoded "1,000".
