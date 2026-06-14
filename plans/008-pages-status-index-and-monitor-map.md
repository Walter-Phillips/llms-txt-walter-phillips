# Plan 008: Add a `(site_id, status)` index and fix the O(N) lookup in the no-sitemap monitor path

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 66f82d7..HEAD -- packages/db/src/schema.ts packages/db/migrations apps/api/src/queue/monitor-consumer.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `66f82d7`, 2026-06-14

## Why this matters

Two hot queries filter pages by `(site_id, status = 'active')` — the generator
on every run (`generator/index.ts:72-82`) and the monitor on every check
(`monitor-consumer.ts:60-69`). The `pages` table has an index on `site_id`
alone, so D1 must scan all rows for the site and filter `status` in memory; for
a site near the 1,000-page cap that's a full per-site scan on every generate and
every monitor tick. Separately, the **no-sitemap** monitor branch does an O(N)
`activePages.find(...)` inside a loop over sampled URLs
(`monitor-consumer.ts:96-100`), while the sitemap branch 9 lines above already
builds an O(1) `Map` — so the cheaper path is also the inconsistent one. Both
fixes are small, low-risk, and align the two branches.

## Current state

### Index gap — `packages/db/src/schema.ts:41-44`

```ts
(t) => ({
  siteUrlIdx: uniqueIndex("pages_site_url_idx").on(t.siteId, t.url),
  siteIdx: index("pages_site_idx").on(t.siteId),
}),
```

The two filtering queries:

```ts
// apps/api/src/generator/index.ts:72-82
.from(pages).where(and(eq(pages.siteId, siteId), eq(pages.status, "active"), …))

// apps/api/src/queue/monitor-consumer.ts:60-69
.from(pages).where(and(eq(pages.siteId, siteId), eq(pages.status, "active")))
```

### O(N) lookup — `apps/api/src/queue/monitor-consumer.ts:83-101`

```ts
if (sitemap) {
  …
  const validators = new Map(activePages.map((p) => [p.url, p]));   // ← O(1) map (good)
  for (const url of byDepth(sitemapDiff.lastmodChanged).slice(0, MAX_CONDITIONAL_GETS)) {
    const stored = validators.get(url);
    if (!stored) continue;
    record(url, await conditionalCheck(url, stored));
  }
} else {
  // No sitemap: sample known pages, shallowest first.
  for (const page of byDepth(activePages.map((p) => p.url)).slice(0, MAX_CONDITIONAL_GETS)) {
    const stored = activePages.find((p) => p.url === page);          // ← O(N) scan per iteration (the fix)
    if (!stored) continue;
    record(page, await conditionalCheck(page, stored));
  }
}
```

### Migration conventions

Migrations are hand-written SQL in `packages/db/migrations/`, applied by
`wrangler d1 migrations apply`. Existing files: `0000_init.sql` (creates the
`CREATE INDEX pages_site_idx ON pages(site_id);`) and
`0001_run_change_summary.sql` (a one-line `ALTER TABLE`). The schema file
(`schema.ts`) is the Drizzle source of truth and **must** be kept in sync with
the SQL migration — see `ARCHITECTURE.md`: "Drizzle ORM schema + hand-rolled D1
migrations. Single source of truth for table shapes."

## Commands you will need

| Purpose          | Command                                                       | Expected on success |
|------------------|---------------------------------------------------------------|---------------------|
| Typecheck        | `pnpm --filter @profound-takehome/api typecheck`              | exit 0              |
| DB typecheck     | `pnpm --filter @profound-takehome/db typecheck`               | exit 0              |
| Tests            | `pnpm --filter @profound-takehome/api test`                   | all pass            |
| Apply migration (local, optional) | `pnpm --filter @profound-takehome/api db:migrate:local` | applies cleanly |
| Full gate        | `pnpm verify`                                                 | exit 0              |

## Scope

**In scope** (the only files you should modify/create):
- `packages/db/src/schema.ts` — add the composite index to the `pages` table def.
- `packages/db/migrations/0002_pages_site_status_idx.sql` (create) — the
  matching `CREATE INDEX`.
- `apps/api/src/queue/monitor-consumer.ts` — replace the `.find()` with a `Map`
  lookup in the no-sitemap branch.

**Out of scope** (do NOT touch):
- `apps/api/src/generator/index.ts` — it benefits from the index automatically;
  no code change needed there.
- Any other table's indexes; query shapes; the `byDepth` helper.
- Do NOT run `db:migrate:remote` (production) — local apply only, and only as an
  optional sanity check.

## Git workflow

- Branch: `advisor/008-pages-status-index`
- Commit style: conventional commits, e.g.
  `perf(db): index pages(site_id,status); map lookup in monitor`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the composite index to the schema

In `packages/db/src/schema.ts`, add to the `pages` table's index map:

```ts
(t) => ({
  siteUrlIdx: uniqueIndex("pages_site_url_idx").on(t.siteId, t.url),
  siteIdx: index("pages_site_idx").on(t.siteId),
  siteStatusIdx: index("pages_site_status_idx").on(t.siteId, t.status),
}),
```

**Verify**: `pnpm --filter @profound-takehome/db typecheck` → exit 0.

### Step 2: Write the matching migration

Create `packages/db/migrations/0002_pages_site_status_idx.sql`:

```sql
-- Speed up the hot (site_id, status='active') filters used by the generator
-- (every run) and the monitor (every check). Without this only site_id is
-- indexed, forcing an in-memory status filter over all of a site's pages.

CREATE INDEX pages_site_status_idx ON pages(site_id, status);
```

(Match the comment-then-statement style of `0001_run_change_summary.sql`.)

**Verify**: optionally `pnpm --filter @profound-takehome/api db:migrate:local`
applies without error (requires local wrangler/D1 provisioned per README; if
not provisioned, skip and rely on the SQL being valid SQLite).

### Step 3: Replace the O(N) `.find()` with a Map in the no-sitemap branch

In `apps/api/src/queue/monitor-consumer.ts`, build the validators map once
before the `if (sitemap)` split so both branches share it, then use it in the
else branch:

```ts
const validators = new Map(activePages.map((p) => [p.url, p]));

if (sitemap) {
  sitemapDiff = diffSitemap(activePages, sitemap);
  for (const url of byDepth(sitemapDiff.lastmodChanged).slice(0, MAX_CONDITIONAL_GETS)) {
    const stored = validators.get(url);
    if (!stored) continue;
    record(url, await conditionalCheck(url, stored));
  }
} else {
  for (const page of byDepth(activePages.map((p) => p.url)).slice(0, MAX_CONDITIONAL_GETS)) {
    const stored = validators.get(page);
    if (!stored) continue;
    record(page, await conditionalCheck(page, stored));
  }
}
```

This removes the duplicate inline `new Map(...)` from the sitemap branch (it now
lives above the split) and the `.find()` from the else branch. Behavior is
identical — same pages checked, same order.

**Verify**: `pnpm --filter @profound-takehome/api typecheck` → exit 0.

### Step 4: Run the suite

The monitor consumer tests (`apps/api/src/queue/monitor-consumer.test.ts`,
`apps/api/src/monitor/detect.test.ts`) must still pass — the lookup change is
behavior-preserving.

**Verify**: `pnpm --filter @profound-takehome/api test` → all pass.

### Step 5: Full gate

**Verify**: `pnpm verify` from repo root → exit 0.

## Test plan

- No new unit test for the index (it's a query-planner optimization; behavior is
  unchanged). The existing monitor/generator tests guard correctness.
- If you want a guard against the schema/migration drifting, the repo's doc
  check (`pnpm check-docs`) and typecheck already run via `pnpm verify`.
- Verification: `pnpm --filter @profound-takehome/api test` → all pass;
  `pnpm verify` → exit 0.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n "pages_site_status_idx" packages/db/src/schema.ts packages/db/migrations/0002_pages_site_status_idx.sql` shows the index in both schema and migration
- [ ] `grep -n "activePages.find" apps/api/src/queue/monitor-consumer.ts` returns no matches
- [ ] `grep -c "new Map(activePages" apps/api/src/queue/monitor-consumer.ts` returns `1` (single shared map, not two)
- [ ] `pnpm --filter @profound-takehome/api test` exits 0
- [ ] `pnpm --filter @profound-takehome/db typecheck` exits 0
- [ ] `pnpm verify` exits 0
- [ ] `git status` shows only the three in-scope files (schema, new migration, monitor-consumer)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The `pages` index map or the monitor branch no longer matches the "Current
  state" excerpts.
- `db:migrate:local` fails for a reason other than "resources not provisioned"
  (e.g. the SQL is rejected by SQLite) — fix the SQL, don't skip the step.
- Sharing the `validators` map changes which pages are checked in either branch
  (it should not — verify against the monitor tests).

## Maintenance notes

- The schema def and the SQL migration are two sources that must agree. A
  reviewer should confirm `0002_*.sql` matches the `siteStatusIdx` line in
  `schema.ts`. If the team adopts `drizzle-kit generate`, regenerate instead of
  hand-writing future migrations.
- `pages_site_idx` (site_id only) is now partially redundant with the composite
  `(site_id, status)` for site-only lookups. Leaving it is fine (SQLite can use
  either); a follow-up could drop it, but that's not worth a migration on its own.
- If `status` ever gains more values used in filters (e.g. querying `removed`),
  this same index serves them.
