# Plan 009: Fill in the TBD environment-variable and quality-scorecard docs

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 66f82d7..HEAD -- docs/SECURITY.md docs/QUALITY.md apps/api/src/bindings.ts apps/api/wrangler.toml`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `66f82d7`, 2026-06-14

## Why this matters

`docs/SECURITY.md` is the documented authority for required env vars (per its own
heading and `AGENTS.md`'s "Document third-party service access and required
environment variables"), but its table is a `TBD` placeholder — so a new
contributor or operator has no single source for what secrets the Worker needs.
`docs/QUALITY.md`'s scorecard is likewise all `TBD`. The real values are
knowable from the code (`bindings.ts`, `wrangler.toml`, the README). Filling them
in is low-effort, removes onboarding friction, and the env-var table doubles as
a deploy checklist. This is a docs-only change — no behavior moves.

## Current state

```md
<!-- docs/SECURITY.md:10-15 -->

## Environment Variables

| Name | Required | Description                   |
| ---- | -------- | ----------------------------- |
| TBD  | No       | Add variables as they appear. |
```

```md
<!-- docs/QUALITY.md:10-18 -->

## Scorecard

| Area             | Grade | Notes |
| ---------------- | ----- | ----- |
| Product behavior | TBD   |       |
| Architecture     | TBD   |       |
| Tests            | TBD   |       |
| Documentation    | TBD   |       |
```

The actual env/secret surface (ground truth):

- `apps/api/src/bindings.ts:8-17` — the Worker `Env`:
  `DB` (D1), `FILES` (R2), `RATE_LIMIT` (KV — provisioned, currently unused),
  `CRAWL_QUEUE`, `MONITOR_QUEUE` (Queues), `SITE_COORDINATOR` (DO),
  `ANTHROPIC_API_KEY` (string secret), `APP_ORIGIN` (string).
- `apps/api/wrangler.toml` — bindings declared there; `APP_ORIGIN` is in
  `[vars]` (`https://llms-txt.example.com`); `ANTHROPIC_API_KEY` is set via
  `wrangler secret put ANTHROPIC_API_KEY` (comment in the toml + README);
  local dev reads it from `apps/api/.dev.vars` (gitignored).
- `apps/api/.env.example` — documents `ANTHROPIC_API_KEY` for `wrangler dev`.
- Web side: `NEXT_PUBLIC_API_URL` (Worker URL, defaults to
  `http://localhost:8787` — see `apps/web/src/lib/api.ts:45`) and
  `NEXT_PUBLIC_API_MOCK=1` (mock UI mode — see `docs/RELIABILITY.md` and README).
- `ANTHROPIC_API_KEY` is **optional for local mock mode** but **required for real
  generation** (the LLM refinement pass; `generator/index.ts:97` reads it, and
  failure falls back to heuristics — so generation still works without it, just
  unrefined). State this nuance accurately.

There is a doc-harness check: `pnpm check-docs` runs
`python3 scripts/check_harness.py`. Whatever it validates, it must still pass
after the edits.

## Commands you will need

| Purpose   | Command           | Expected on success |
| --------- | ----------------- | ------------------- |
| Doc check | `pnpm check-docs` | exit 0              |
| Full gate | `pnpm verify`     | exit 0              |

## Scope

**In scope** (the only files you should modify):

- `docs/SECURITY.md` — replace the TBD env-var table with the real variables.
- `docs/QUALITY.md` — replace the TBD scorecard with an honest current-state
  assessment.

**Out of scope** (do NOT touch):

- Any source code, `wrangler.toml`, `.env.example`, or the README. This is
  docs-only. If the docs and code disagree, document what the **code** does and
  note the discrepancy — do not change code to match the docs.
- `scripts/check_harness.py` — do not modify the checker to make edits pass.
- Do not invent env vars not present in `bindings.ts`/`wrangler.toml`.

## Git workflow

- Branch: `advisor/009-fill-docs`
- Commit style: conventional commits, e.g.
  `docs: document required env vars and quality scorecard`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Confirm the env surface from the code

Read `apps/api/src/bindings.ts`, `apps/api/wrangler.toml`,
`apps/api/.env.example`, and `apps/web/src/lib/api.ts` (the
`NEXT_PUBLIC_API_URL`/`NEXT_PUBLIC_API_MOCK` reads). Build the authoritative
list. Do not list bindings that are wired purely via `wrangler.toml` (D1/R2/KV/
Queues/DO) as "environment variables" unless you label them clearly as
**bindings** vs **secrets/vars** — keep the two categories distinct in the table.

**Verify**: no command — this is a read step. Have the list ready before editing.

### Step 2: Rewrite the SECURITY.md env table

Replace the `TBD` table with two short tables (or one table with a Type column).
Cover at least:

- `ANTHROPIC_API_KEY` — secret — _required for real generation; optional in mock
  mode (LLM refinement falls back to heuristics if absent)_. Set via
  `wrangler secret put` in prod, `apps/api/.dev.vars` locally.
- `APP_ORIGIN` — var (`wrangler.toml [vars]`) — the app's public origin.
- `NEXT_PUBLIC_API_URL` — web env — Worker base URL (defaults to
  `http://localhost:8787`).
- `NEXT_PUBLIC_API_MOCK` — web env — `1` enables the in-memory mock UI.
- Bindings (D1 `DB`, R2 `FILES`, KV `RATE_LIMIT`, Queues `CRAWL_QUEUE`/
  `MONITOR_QUEUE`, DO `SITE_COORDINATOR`) — listed as wrangler-configured
  bindings, not loose env vars.

Keep descriptions one line each. Do not reproduce any secret value (there are
none to reproduce — `.env.example` uses an `sk-ant-xxxxxxxxxx` placeholder; do
not copy even that).

**Verify**: `pnpm check-docs` → exit 0.

### Step 3: Fill the QUALITY.md scorecard honestly

Replace each `TBD` with a brief, accurate grade + note grounded in the repo's
actual state (not aspirational). Suggested honest assessment as of this commit:

- **Product behavior** — the three workflows (Generate / Watch / History) are
  wired end-to-end; note any known gap you can verify.
- **Architecture** — clean layering per `ARCHITECTURE.md`; the spec validator
  gates every file write.
- **Tests** — core pure logic (validator, heuristics, detect, schedule, frontier,
  sitemap, url) is unit-tested; the Durable Object, HTTP routes, and the
  `generate()` pipeline have thinner/under-construction coverage (plans 003/005
  address this — you may reference them).
- **Documentation** — product/architecture/reliability docs are solid; this plan
  closes the SECURITY/QUALITY TBDs.

Use a simple grade vocabulary (e.g. Good / Fair / Needs work) and keep notes to
one line. Do not overstate — a reviewer should recognize the assessment as true.

**Verify**: `pnpm check-docs` → exit 0.

### Step 4: Full gate

**Verify**: `pnpm verify` from repo root → exit 0.

## Test plan

- No code tests. The guard is `pnpm check-docs` (the doc harness) plus a human
  read for accuracy.
- Verification: `pnpm check-docs` → exit 0; `pnpm verify` → exit 0.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -c "TBD" docs/SECURITY.md docs/QUALITY.md` returns `0` for both files
- [ ] `grep -n "ANTHROPIC_API_KEY" docs/SECURITY.md` shows it documented
- [ ] `pnpm check-docs` exits 0
- [ ] `pnpm verify` exits 0
- [ ] `git status` shows only `docs/SECURITY.md` and `docs/QUALITY.md` changed
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `pnpm check-docs` fails and the failure is about doc _structure_ the harness
  enforces (e.g. a required heading) rather than your content — read
  `scripts/check_harness.py` to learn the contract, but do **not** modify it.
- `bindings.ts`/`wrangler.toml` reveal an env var or secret not described here —
  document it; if its purpose is unclear from the code, note it as "purpose
  unconfirmed" rather than guessing.
- The "Current state" excerpts no longer match the docs (someone already edited
  them).

## Maintenance notes

- The SECURITY.md env table is now a deploy checklist. When a new binding or
  secret is added to `bindings.ts`/`wrangler.toml`, update this table in the same
  PR (consider noting that expectation near the table).
- The QUALITY scorecard is a point-in-time snapshot; it will drift. If plans
  003/005 land, the Tests row should be upgraded — a reviewer of those PRs should
  bump it.
- `RATE_LIMIT` (KV) is provisioned but unused (see the direction plan on rate
  limiting). The env table should reflect "provisioned, not yet enforced" so it
  isn't mistaken for an active control.
