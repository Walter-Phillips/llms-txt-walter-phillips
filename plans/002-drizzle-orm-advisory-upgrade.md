# Plan 002: Upgrade drizzle-orm past the GHSA-gpj5-g38j-94v9 SQL-injection advisory

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 66f82d7..HEAD -- apps/api/package.json packages/db/package.json pnpm-lock.yaml`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: migration (security-driven)
- **Planned at**: commit `66f82d7`, 2026-06-14

## Why this matters

`pnpm audit --prod` reports a **HIGH** advisory (GHSA-gpj5-g38j-94v9) against
`drizzle-orm@0.36.4`, which is a **runtime** dependency on the Worker's data
path. Patched in `>=0.45.2`; the repo is ~9 minor versions behind. The repo's
queries are parameterized (no `sql.raw` with user input was found), so this is
defense-in-depth rather than a known live exploit here — but it's a HIGH
advisory on a production dependency, it's cheap to clear, and leaving it makes
every future `audit` run noisy enough that real findings get ignored.

## Current state

- `apps/api/package.json:21` — `"drizzle-orm": "^0.36.0"`
- `packages/db/package.json:17` — `"drizzle-orm": "^0.36.0"`
- Both resolve to `0.36.4` (confirmed by `pnpm audit --prod`).
- Drizzle is used in: `packages/db/src/schema.ts` (table defs via
  `drizzle-orm/sqlite-core`), and across `apps/api/src/**` via
  `drizzle-orm/d1` + query helpers `and, eq, desc, gte, inArray` from
  `drizzle-orm`. All usage is the typed query builder — no raw SQL string
  interpolation of request data was found during the audit.
- `drizzle-kit` is the migration generator (`packages/db/drizzle.config.ts`);
  migrations are hand-checked SQL in `packages/db/migrations/`.
- Repo conventions: this is a pnpm workspace (`packageManager: pnpm@9.15.0`);
  the lockfile `pnpm-lock.yaml` is committed and must be updated by the tool,
  not by hand.

## Commands you will need

| Purpose          | Command                                              | Expected on success            |
|------------------|------------------------------------------------------|--------------------------------|
| Audit (before)   | `pnpm audit --prod`                                  | shows the drizzle-orm HIGH     |
| Upgrade          | `pnpm --filter @profound-takehome/api --filter @profound-takehome/db up drizzle-orm@latest` | resolves to ≥0.45.2 |
| Audit (after)    | `pnpm audit --prod`                                  | drizzle-orm HIGH gone          |
| Typecheck (all)  | `pnpm typecheck`                                     | exit 0, no errors              |
| Tests (all)      | `pnpm test`                                          | all pass                       |
| Lint             | `pnpm lint`                                          | exit 0                         |
| Full gate        | `pnpm verify`                                        | exit 0                         |

## Scope

**In scope** (the only files you should modify):
- `apps/api/package.json` — bump `drizzle-orm`
- `packages/db/package.json` — bump `drizzle-orm` (keep the two in lockstep)
- `pnpm-lock.yaml` — updated by `pnpm up` (do not hand-edit)
- At most: small call-site fixes in `apps/api/src/**` or `packages/db/src/schema.ts`
  **only if** the upgrade produces type/test errors (see Step 3).

**Out of scope** (do NOT touch, even though they look related):
- `drizzle-kit` major upgrades and migration **regeneration** — do not run
  `drizzle-kit generate`/`push`. Existing migrations in `packages/db/migrations/`
  are hand-maintained and must not be rewritten by this plan.
- `vitest`, `next`, `postcss`, or any other audit advisory — separate concerns.
- The D1 schema shape (`schema.ts` table/column definitions) — only adjust if
  the new drizzle version *requires* a syntactic change to compile.

## Git workflow

- Branch: `advisor/002-drizzle-upgrade`
- Commit style: conventional commits, e.g.
  `chore(deps): upgrade drizzle-orm to clear GHSA-gpj5-g38j-94v9`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Record the baseline

Run `pnpm audit --prod` and confirm the drizzle-orm HIGH advisory is listed.

**Verify**: output contains `drizzle-orm` with `Vulnerable versions <0.45.2`.

### Step 2: Upgrade in both packages together

Run:

```
pnpm --filter @profound-takehome/api --filter @profound-takehome/db up drizzle-orm@latest
```

Confirm both `package.json` files now reference a version `>=0.45.2` and that
`pnpm-lock.yaml` changed.

**Verify**: `grep -n '"drizzle-orm"' apps/api/package.json packages/db/package.json`
→ both show `>=0.45.2`. `pnpm audit --prod` → no drizzle-orm advisory.

### Step 3: Typecheck and fix any breaking-change fallout

Run `pnpm typecheck`. Drizzle minor bumps occasionally tighten types around
`.get()`/`.all()`, `onConflictDoUpdate`, or `sql` helpers. If errors appear,
fix them **minimally** at the call site to satisfy the new types — do not
refactor. The files most likely to surface changes:
- `packages/db/src/schema.ts` (index/column builder API)
- `apps/api/src/generator/index.ts`, `apps/api/src/api/files.ts`,
  `apps/api/src/queue/*.ts` (query builder + `onConflictDoUpdate` usage)

If a breaking change requires touching more than ~3 files or changing a query's
*behavior* (not just its types), STOP and report.

**Verify**: `pnpm typecheck` → exit 0.

### Step 4: Run the suite

**Verify**: `pnpm test` → all pass. Pay attention to
`apps/api/src/queue/crawl-consumer.test.ts` and any test that exercises
`onConflictDoUpdate` shapes.

### Step 5: Full gate

**Verify**: `pnpm verify` → exit 0.

## Test plan

- No new tests required — this is a dependency bump. The existing suite is the
  regression guard.
- If Step 3 required a call-site change to a query, add a focused test only if
  the change altered observable behavior (otherwise the existing tests suffice).
- Verification: `pnpm test` → all pass; `pnpm audit --prod` → drizzle advisory
  cleared.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n '"drizzle-orm"' apps/api/package.json packages/db/package.json` shows `>=0.45.2` in both
- [ ] `pnpm audit --prod` no longer lists a `drizzle-orm` advisory
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0
- [ ] `pnpm verify` exits 0
- [ ] `git status` shows only `package.json` (×2), `pnpm-lock.yaml`, and any minimal call-site fixes from Step 3
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The current versions in the two `package.json` files are not `^0.36.0`
  (drift — someone already changed them).
- The upgrade forces a `drizzle-kit` major bump or migration regeneration.
- Typecheck/test fallout requires touching more than ~3 files or changing query
  behavior.
- `pnpm up` cannot resolve `>=0.45.2` (peer-dependency conflict with
  `@cloudflare/workers-types` or `drizzle-kit`).

## Maintenance notes

- After this lands, `pnpm audit --prod` should be clean except for the
  `postcss` moderate advisory (transitive via `next`) — that is tracked
  separately and is build-time only; do not chase it in this plan.
- Keep `drizzle-orm` versions identical across `apps/api` and `packages/db`;
  a skew between the schema package and the consumer is a known source of
  subtle type drift.
- A reviewer should skim the drizzle `0.37→0.45` changelog for any change to
  `onConflictDoUpdate` / D1 batch semantics, since the crawl consumer relies on
  upsert idempotency.
