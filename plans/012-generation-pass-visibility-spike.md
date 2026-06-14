# Plan 012 (spike): Surface which generation pass (heuristic vs LLM-refined) produced the file

> **Executor instructions**: This is a **design/spike** plan. Produce the design
> note and a thin typed slice, then STOP for review. Run the verification
> commands. If a STOP condition occurs, stop and report. When done, update the
> status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 66f82d7..HEAD -- apps/api/src/generator/index.ts packages/db/src/schema.ts packages/shared/src/contracts.ts apps/web/src/components/result-view.tsx`

## Status

- **Priority**: P3
- **Effort**: M (coarse — DB + generator + contract + UI)
- **Risk**: LOW
- **Depends on**: none (but pairs naturally with plan 005's generator tests)
- **Category**: direction
- **Planned at**: commit `66f82d7`, 2026-06-14

## Why this matters

`generate()` (`apps/api/src/generator/index.ts`) always runs deterministic Pass 1
heuristics, then _attempts_ Pass 2 LLM refinement and **silently** falls back to
Pass 1 on any failure (thrown error, `null`, or refined output failing
validation — lines 94-112). This graceful degradation is good engineering, but
it's invisible: a user can't tell whether they're looking at a polished,
LLM-refined file or the heuristic floor, and an operator debugging "why does this
file look rough?" has no signal short of reading logs. Recording and surfacing
the pass that produced each version makes the system legible — "AI-refined" vs
"Heuristic" — which matters for a product whose value is file quality. This spike
designs it and lands a typed slice; it does **not** add a user toggle (that's a
heavier product decision, noted as an open question).

## Current state

```ts
// apps/api/src/generator/index.ts:86-112 (abridged)
const inventory = buildInventory(rows, origin);
let content = render(inventory, defaultSummary(inventory));   // Pass 1 = the floor
const baseCheck = validate(content, origin);
if (!baseCheck.ok) throw new Error(`generate: heuristic output failed validation: …`);

try {
  const refined = await refine(inventory, env.ANTHROPIC_API_KEY);
  if (refined) {
    const refinedContent = render(refined.inventory, refined.summary);
    const refinedCheck = validate(refinedContent, origin);
    if (refinedCheck.ok) {
      content = refinedContent;              // ← Pass 2 used (the only "refined" branch)
    } else {
      console.warn("…refined output failed validation, shipping pass 1", …);
    }
  }
} catch (err) {
  console.warn("…LLM refinement failed, shipping pass 1", …);
}
// …then publish `content` and insert a file_versions row (lines 120-152)
```

- The single point where Pass 2 "wins" is `content = refinedContent`. Everywhere
  else, `content` is the Pass 1 floor. So the pass is knowable with one boolean
  set at that assignment.
- `file_versions` table (`packages/db/src/schema.ts:70-86`) records
  `version`, `r2Key`, `changeSummary`, `createdAt` — no `generated_by` field.
- `packages/shared/src/contracts.ts` — the `latestVersion`/versions responses
  flow to the UI. `apps/web/src/components/result-view.tsx` renders the result.
- `ANTHROPIC_API_KEY` may be absent in local/mock contexts; refinement then
  fails and Pass 1 ships — exactly the case worth labeling.

## Deliverables

1. **A design note** at `docs/exec-plans/generation-pass-visibility.md` (create):
   - The value to record per version: a `generatedBy` enum
     `"heuristic" | "llm-refined"`. Recommend storing it on `file_versions` (it's
     a property of the produced file, not the run).
   - Where it's set in `generate()` (the `content = refinedContent` branch →
     `"llm-refined"`, else `"heuristic"`), how it flows through the contract to
     the UI, and the UI treatment (a small badge near the rendered file).
   - Open questions for the operator: (a) do we also want to expose _why_ Pass 2
     was skipped (no key / error / validation miss) for operators, or just the
     outcome for users? (b) a user-facing **toggle** to force a pass — recommend
     **deferring**; it's a product decision and the current always-try/fallback
     default is sound. Note it; don't build it.
2. **A thin typed slice** for the `generatedBy` outcome: schema field +
   migration, `generate()` sets it, contract exposes it, result view shows a
   badge. Extend plan 005's generator tests (or add) to assert the value for the
   fallback and refined paths.

## Commands you will need

| Purpose       | Command                                          | Expected on success |
| ------------- | ------------------------------------------------ | ------------------- |
| API typecheck | `pnpm --filter @profound-takehome/api typecheck` | exit 0              |
| DB typecheck  | `pnpm --filter @profound-takehome/db typecheck`  | exit 0              |
| Web typecheck | `pnpm --filter @profound-takehome/web typecheck` | exit 0              |
| Tests         | `pnpm test`                                      | all pass            |
| Doc check     | `pnpm check-docs`                                | exit 0              |
| Full gate     | `pnpm verify`                                    | exit 0              |

## Scope

**In scope** (thin slice):

- `docs/exec-plans/generation-pass-visibility.md` (create).
- `packages/db/src/schema.ts` — add `generatedBy: text("generated_by")` (nullable for back-compat) to `file_versions`.
- `packages/db/migrations/00NN_file_version_generated_by.sql` (create) — `ALTER TABLE file_versions ADD COLUMN generated_by TEXT;` (next free number).
- `apps/api/src/generator/index.ts` — track the pass; write it on the
  `file_versions` insert (lines 136-144).
- `packages/shared/src/contracts.ts` — add optional `generatedBy` to the version
  response schema (+ a contract test in `packages/shared/src/index.test.ts`).
- `apps/web/src/components/result-view.tsx` — render a small badge from
  `generatedBy`.
- Generator tests (coordinate with plan 005 if it has landed; otherwise add a
  focused test): assert `"heuristic"` on the LLM-throw/null/invalid-refine paths
  and `"llm-refined"` when refinement is applied.

**Out of scope** (STOP if pulled here):

- A user-facing toggle / `refinementMode` request param (product decision —
  open question only).
- Changing the fallback behavior itself (it's correct; only _record_ the outcome).
- Backfilling `generated_by` for existing rows (nullable handles old rows;
  note it).

## Git workflow

- Branch: `advisor/012-generation-pass-visibility`
- Commit style: conventional commits, e.g.
  `feat: record and surface generation pass (heuristic vs llm-refined)`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Write the design note

Create `docs/exec-plans/generation-pass-visibility.md` per Deliverables item 1.

**Verify**: `pnpm check-docs` → exit 0.

### Step 2: Schema + migration

Add nullable `generatedBy` to `file_versions` in `schema.ts`; add the matching
`ALTER TABLE … ADD COLUMN generated_by TEXT;` migration (next free number). Match
`0001_run_change_summary.sql`'s style.

**Verify**: `pnpm --filter @profound-takehome/db typecheck` → exit 0.

### Step 3: Track + persist the pass in `generate()`

Introduce a local `let generatedBy: "heuristic" | "llm-refined" = "heuristic";`
set to `"llm-refined"` exactly where `content = refinedContent` happens. Pass it
into the `file_versions` insert values (index.ts:136-144). No behavior change to
fallback logic — additive only.

**Verify**: `pnpm --filter @profound-takehome/api typecheck` → exit 0.

### Step 4: Contract + UI + tests

Add optional `generatedBy` to the version response in `contracts.ts` (+ contract
test). In `result-view.tsx`, render a small badge ("AI-refined" / "Heuristic")
from the value. Extend/add generator tests to assert the recorded value across
the refined and all-three-fallback paths (reuse plan 005's fakes if present).

**Verify**: `pnpm --filter @profound-takehome/web typecheck` → exit 0;
`pnpm test` → all pass.

### Step 5: Full gate, then STOP for review

**Verify**: `pnpm verify` → exit 0. Then **stop** and report the open questions
(operator-facing skip-reason; user toggle deferral).

## Done criteria

- [ ] `docs/exec-plans/generation-pass-visibility.md` exists with the enum, data flow, and open questions
- [ ] `file_versions.generated_by` exists in `schema.ts` and a matching migration
- [ ] `generate()` records `"llm-refined"` vs `"heuristic"`, covered by tests for the refined path AND at least one fallback path
- [ ] `generatedBy` flows through the contract to `result-view.tsx`
- [ ] `pnpm verify` exits 0
- [ ] `git status` shows only in-scope files
- [ ] `plans/README.md` status row updated and open questions reported

## STOP conditions

Stop and report back if:

- Recording the pass appears to require changing the fallback control flow (it
  should be a single boolean at the `content = refinedContent` site).
- The work drifts toward a user toggle / `refinementMode` (out of scope).
- The contract change ripples into more responses than the version/latest-version
  shape.

## Maintenance notes

- The pass is a property of the _file version_, not the run — keep it on
  `file_versions`. If a future change makes Pass 1 and Pass 2 both ship (e.g. a
  preview), this becomes a richer status, but a two-value enum is right today.
- `generated_by` is nullable so pre-existing rows don't need backfill; the UI
  should treat `null` as "unknown" and show no badge rather than a wrong one.
- Pairs with plan 005: those generator tests already exercise the
  throw/null/invalid-refine branches — add the `generatedBy` assertion there to
  avoid duplicate test scaffolding.
