# Plan 004: Make SiteCoordinator `/complete` idempotent so retried queue messages don't double-count

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 66f82d7..HEAD -- apps/api/src/do/site-coordinator.ts apps/api/src/queue/crawl-consumer.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/003-site-coordinator-characterization-tests.md
- **Category**: bug (correctness)
- **Planned at**: commit `66f82d7`, 2026-06-14

## Why this matters

The crawl queue is configured with `max_retries = 2` (`apps/api/wrangler.toml`).
The page handler `handlePage` (`apps/api/src/queue/crawl-consumer.ts:272-380`)
does DB writes and then calls the DO's `/complete` (line 355). If a later step
throws **after** `/complete` already succeeded (e.g. the post-complete
`enqueuePages` on line 363, or any transient error before `msg.ack()`), the
message is retried and `handlePage` runs again — calling `/complete` for the
**same URL** a second time.

In `complete`, the `inFlight.filter(...)` is a no-op on the retry (the URL is
already gone), but `this.state.pagesCrawled++` runs **unconditionally**
(`site-coordinator.ts:132-133`). So `pagesCrawled` over-counts, and because the
drain check is `inFlight.length === 0 && accepted.length === 0`, a duplicate
`complete` after the frontier already drained can re-emit `drained: true`,
re-enqueueing a second `generate` message. Generation is idempotent by `runId`
(`generator/index.ts:63-67`), so no corrupt file results — but the progress
counter shown to users (`api/jobs.ts` proxies `pagesCrawled`) is wrong and the
extra work is wasteful. The fix makes the counter and drain signal depend on
whether the URL was _actually_ in `inFlight`.

## Current state

```ts
// apps/api/src/do/site-coordinator.ts:122-150
private async complete(body: CompleteRequest): Promise<Response> {
  if (body.runId !== this.state.runId) {
    return Response.json({
      accepted: [], drained: false, pagesFound: 0, pagesCrawled: 0,
    } satisfies CompleteResponse);
  }

  this.state.inFlight = this.state.inFlight.filter((u) => u !== body.url);  // ← no-op on retry
  this.state.pagesCrawled++;                                                 // ← always runs (the bug)

  let accepted: { url: string; depth: number }[] = [];
  if (this.state.followLinks && body.links?.length && body.depth < MAX_DEPTH) {
    accepted = this.admit(body.links, body.url, body.depth + 1);
  }

  const drained = this.state.inFlight.length === 0 && accepted.length === 0;
  if (drained) this.state.phase = "generating";
  await this.save();

  return Response.json({
    accepted, drained, pagesFound: this.state.pagesFound, pagesCrawled: this.state.pagesCrawled,
  } satisfies CompleteResponse);
}
```

The caller that can trigger the double-call:

```ts
// apps/api/src/queue/crawl-consumer.ts:355-379  (abridged)
const completion = await doCall<CompleteResponse>(stub, "/complete", { runId, url, links, depth });
try {
  await enqueuePages(env, runId, siteId, completion.accepted);   // ← if THIS throws, msg retries → /complete runs again
} catch (err) { await failRunAfterEnqueueFailure(...); return; }
if (completion.drained) { /* mark generating + send generate message */ }
```

- Plan 003 added `apps/api/src/do/site-coordinator.test.ts`, including a test
  that **characterizes the current double-count** with a comment pointing here.
  This plan flips that test to assert the corrected behavior.
- Conventions: keep the change minimal and inside `complete` (or its extracted
  pure helper if plan 003 took the refactor path). Match existing style.

## Commands you will need

| Purpose   | Command                                                         | Expected on success |
| --------- | --------------------------------------------------------------- | ------------------- |
| Typecheck | `pnpm --filter @profound-takehome/api typecheck`                | exit 0              |
| Tests     | `pnpm --filter @profound-takehome/api test -- site-coordinator` | all pass            |
| Full gate | `pnpm verify`                                                   | exit 0              |

## Scope

**In scope** (the only files you should modify):

- `apps/api/src/do/site-coordinator.ts` — guard the increment on actual removal.
  (If plan 003 extracted an `applyComplete` pure helper, make the change there.)
- `apps/api/src/do/site-coordinator.test.ts` — flip the characterization test to
  assert idempotency; add a dedicated double-complete test.

**Out of scope** (do NOT touch):

- `apps/api/src/queue/crawl-consumer.ts` — do **not** restructure the caller's
  try/catch ordering. The DO is the correct place to be idempotent (the queue
  contract is at-least-once; the DO is the single serialized authority).
- `pagesFound` accounting and `admit` — unchanged.
- Generation idempotency in `generator/index.ts` — already correct; not touched.

## Git workflow

- Branch: `advisor/004-complete-idempotency`
- Commit style: conventional commits, e.g.
  `fix(do): make /complete idempotent against retried page messages`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Increment `pagesCrawled` only when the URL was actually in flight

Change the removal + increment so the counter reflects a real completion. Target
shape:

```ts
const before = this.state.inFlight.length;
this.state.inFlight = this.state.inFlight.filter((u) => u !== body.url);
const wasInFlight = this.state.inFlight.length < before;
if (wasInFlight) this.state.pagesCrawled++;
```

Leave the `accepted`/`drained` logic below it unchanged. Note the drain check
still reads `inFlight.length === 0`; with the increment guarded, a duplicate
`complete` no longer inflates `pagesCrawled`, and re-emitting `drained` is
harmless because (a) generation is idempotent by runId and (b) the counter is
now correct. (If you also want to suppress the redundant `drained` on a
duplicate, gate it on `wasInFlight` too — but keep that change only if it does
not break the "single URL completes → drained" test.)

**Verify**: `pnpm --filter @profound-takehome/api typecheck` → exit 0.

### Step 2: Update the tests to assert idempotency

In `apps/api/src/do/site-coordinator.test.ts`:

- Find the characterization test that pins the double-count (added by plan 003,
  marked with a comment referencing plan 004). Change it to assert that calling
  `complete` **twice for the same URL** leaves `pagesCrawled === 1`.
- Keep the existing single-complete drain test green (one URL seeded → one
  `complete` → `pagesCrawled === 1`, `drained: true`).
- Add a test: seed two URLs, complete URL #1 twice and URL #2 once →
  `pagesCrawled === 2`.

**Verify**: `pnpm --filter @profound-takehome/api test -- site-coordinator`
→ all pass, including the flipped idempotency test.

### Step 3: Full gate

**Verify**: `pnpm verify` from repo root → exit 0.

## Test plan

- Modify the plan-003 double-count characterization test to assert
  `pagesCrawled === 1` after two `complete(sameUrl)` calls.
- Add: two-URL scenario with one duplicate completion → `pagesCrawled === 2`.
- Confirm the drain test (single seeded URL → `drained: true`) still holds.
- Verification: `pnpm --filter @profound-takehome/api test -- site-coordinator`
  → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n "wasInFlight\|inFlight.length < before" apps/api/src/do/site-coordinator.ts` shows the guard (or the equivalent in the extracted helper)
- [ ] `pnpm --filter @profound-takehome/api test -- site-coordinator` passes, including a test that double-`complete` keeps `pagesCrawled` at the real count
- [ ] `pnpm --filter @profound-takehome/api typecheck` exits 0
- [ ] `pnpm verify` exits 0
- [ ] `git status` shows only the two in-scope files changed
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 003 has not landed (no `apps/api/src/do/site-coordinator.test.ts`
  exists) — this plan depends on it for the regression test.
- The `complete` source no longer matches the "Current state" excerpt.
- Guarding the increment breaks the single-URL drain test in a way that implies
  the drain semantics are entangled with the unconditional increment (report the
  interaction; do not paper over it).

## Maintenance notes

- The real invariant: `pagesCrawled` counts **distinct** URLs that left
  `inFlight`. If `inFlight` ever changes from an array to a Set, re-derive
  `wasInFlight` from `Set.delete`'s boolean return.
- A reviewer should confirm the queue caller (`crawl-consumer.ts`) was **not**
  changed — idempotency belongs in the serialized DO, not the at-least-once
  consumer.
- Follow-up deliberately deferred: suppressing the duplicate `generate` enqueue
  entirely. It's harmless today (idempotent generation), so not worth the extra
  state; revisit only if generate-message volume becomes a cost concern.
