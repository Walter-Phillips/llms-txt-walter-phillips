# Plan 007: Consolidate the duplicated URL-path-depth logic into one shared helper

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 66f82d7..HEAD -- apps/api/src/lib/url.ts apps/api/src/crawler/sitemap.ts apps/api/src/queue/monitor-consumer.ts apps/api/src/generator/heuristics.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `66f82d7`, 2026-06-14

## Why this matters

Three places compute "how deep is this URL's path" with near-identical inline
code. Two are byte-for-byte identical; the third differs subtly in its
parse-failure fallback. Duplication like this drifts: a fix to one (say, how a
trailing slash or an unparseable URL is counted) silently won't reach the
others. Extracting a single tested `urlPathDepth` removes two copies and gives
the behavior one place to live. The catch — and the reason this needs care — is
that the third copy's fallback is **deliberately different**, so this plan
consolidates the two identical copies and explicitly decides what to do about
the third rather than flattening a real behavioral difference.

## Current state

**Copy A & B — identical** (`pathname` split, `MAX_SAFE_INTEGER` on parse fail):

```ts
// apps/api/src/crawler/sitemap.ts:119-127 (inside prioritizeShallow)
const depth = (u: string): number => {
  try {
    return new URL(u).pathname.split("/").filter(Boolean).length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
};
```

```ts
// apps/api/src/queue/monitor-consumer.ts:222-231 (exported byDepth)
export function byDepth(urls: string[]): string[] {
  const depth = (u: string): number => {
    try {
      return new URL(u).pathname.split("/").filter(Boolean).length;
    } catch {
      return Number.MAX_SAFE_INTEGER;
    }
  };
  return [...urls].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
}
```

**Copy C — DIFFERENT fallback** (uses `pathOf`, which returns the _url string_
on parse failure, so a bad URL is counted by its raw segments rather than
sorted last):

```ts
// apps/api/src/generator/heuristics.ts:65-69
function pathDepth(url: string): number {
  return pathOf(url)
    .split("/")
    .filter((seg) => seg.length > 0).length;
}
// pathOf (same file, ~lines 55-63): try { return new URL(url).pathname } catch { return url }
```

- `prioritizeShallow` (sitemap) and `byDepth` (monitor) only need _relative
  ordering_, and both push unparseable URLs to the end — the shared helper
  should preserve that (`MAX_SAFE_INTEGER` fallback).
- `pathDepth` (heuristics) is used for page ranking; its `pathOf` fallback is a
  different choice. **This plan does not change Copy C's behavior** — see
  Step 3 for the decision.
- Conventions: pure URL helpers live in `apps/api/src/lib/url.ts` (currently
  exports `normalizeOrigin`, `normalizeUrl`). Tests are plain vitest; see
  `apps/api/src/lib/url.test.ts`.

## Commands you will need

| Purpose   | Command                                          | Expected on success |
| --------- | ------------------------------------------------ | ------------------- |
| Typecheck | `pnpm --filter @profound-takehome/api typecheck` | exit 0              |
| Tests     | `pnpm --filter @profound-takehome/api test`      | all pass            |
| Full gate | `pnpm verify`                                    | exit 0              |

## Scope

**In scope** (the only files you should modify):

- `apps/api/src/lib/url.ts` — add exported `urlPathDepth(url: string): number`.
- `apps/api/src/lib/url.test.ts` — tests for the new helper.
- `apps/api/src/crawler/sitemap.ts` — replace Copy A's inline `depth` with the import.
- `apps/api/src/queue/monitor-consumer.ts` — replace Copy B's inline `depth` with the import (keep `byDepth`'s exported signature and the `localeCompare` tiebreaker).

**Out of scope** (do NOT touch unless Step 3 decides to):

- `apps/api/src/generator/heuristics.ts` Copy C — only change it if Step 3's
  analysis proves its `pathOf` fallback is behaviorally equivalent for its
  inputs. Default is **leave it alone**.
- The sort tiebreakers in `prioritizeShallow` (url length, then lexicographic)
  and `byDepth` (`localeCompare`) — keep them exactly; only the depth primitive
  is shared.

## Git workflow

- Branch: `advisor/007-url-depth-helper`
- Commit style: conventional commits, e.g.
  `refactor(api): extract shared urlPathDepth helper`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add `urlPathDepth` to `lib/url.ts`

```ts
/**
 * Number of non-empty path segments in a URL. Unparseable URLs sort last
 * (returns Number.MAX_SAFE_INTEGER) — matches the crawler/monitor ordering
 * convention. NOT for ranking that needs a different fallback.
 */
export function urlPathDepth(url: string): number {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}
```

**Verify**: `pnpm --filter @profound-takehome/api typecheck` → exit 0.

### Step 2: Add tests for the helper

In `apps/api/src/lib/url.test.ts`, add a `describe("urlPathDepth")` block:
`https://x.test/` → 0; `https://x.test/a` → 1; `https://x.test/a/b/` → 2
(trailing slash ignored via `filter(Boolean)`); `"not a url"` →
`Number.MAX_SAFE_INTEGER`.

**Verify**: `pnpm --filter @profound-takehome/api test -- url` → all pass.

### Step 3: Decide on Copy C (heuristics) before touching anything else

Read `pathOf`/`pathDepth` in `apps/api/src/generator/heuristics.ts` and how
`pathDepth` is used (page ranking). Decision rule:

- If `pathDepth` is only ever called on URLs already known to parse (e.g. they
  came from the inventory built from successfully-crawled pages), then its
  `pathOf` fallback is **never exercised** and switching it to `urlPathDepth` is
  safe and equivalent. In that case, replace it and add it to the in-scope list.
- If you cannot prove the inputs always parse, **leave Copy C unchanged**. The
  fallback difference (counting a bad URL's raw segments vs. sorting it last) is
  a real behavioral choice and consolidating it would be a silent change.

Record your decision in the commit message. Default to leaving it.

**Verify**: no command — this is an analysis gate. State the decision explicitly
before Step 4.

### Step 4: Replace Copy A (sitemap) and Copy B (monitor)

- In `apps/api/src/crawler/sitemap.ts`, import `urlPathDepth` from `../lib/url`
  and replace the inline `depth` in `prioritizeShallow` with it (keep the sort
  comparator and tiebreakers identical).
- In `apps/api/src/queue/monitor-consumer.ts`, import `urlPathDepth` from
  `../lib/url` and replace the inline `depth` inside `byDepth` (keep `byDepth`'s
  exported signature and the `|| a.localeCompare(b)` tiebreaker).

**Verify**: `pnpm --filter @profound-takehome/api typecheck` → exit 0.

### Step 5: Run the suite

The existing tests cover both call sites: `apps/api/src/crawler/sitemap.test.ts`
exercises `prioritizeShallow`, and `apps/api/src/monitor/detect.test.ts` /
`monitor-consumer` tests exercise `byDepth`. They must still pass unchanged —
that's the behavior-preservation proof.

**Verify**: `pnpm --filter @profound-takehome/api test` → all pass.

### Step 6: Full gate

**Verify**: `pnpm verify` from repo root → exit 0.

## Test plan

- New `urlPathDepth` tests in `apps/api/src/lib/url.test.ts` (root, one-segment,
  trailing-slash, unparseable).
- No new tests for the call sites — the existing `sitemap.test.ts` and
  monitor/detect tests are the behavior-preservation guard; they must pass
  unchanged.
- Verification: `pnpm --filter @profound-takehome/api test` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n "urlPathDepth" apps/api/src/lib/url.ts` shows the export
- [ ] `grep -rn "new URL(.*).pathname.split" apps/api/src/crawler/sitemap.ts apps/api/src/queue/monitor-consumer.ts` returns **no** matches (both inline copies removed)
- [ ] `pnpm --filter @profound-takehome/api test` exits 0 (existing sitemap + monitor tests pass unchanged)
- [ ] `pnpm --filter @profound-takehome/api typecheck` exits 0
- [ ] `pnpm verify` exits 0
- [ ] `git status` shows only in-scope files (heuristics.ts only if Step 3 chose to include it)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- An existing sitemap or monitor test fails after the swap (the helper's
  behavior diverges from the inline copy — investigate the tiebreaker/fallback).
- Step 3 analysis is inconclusive about Copy C's inputs — leave it and note the
  open question; do not guess.
- The "Current state" excerpts no longer match the source.

## Maintenance notes

- `urlPathDepth` deliberately sorts unparseable URLs last. If a caller ever
  needs a _different_ fallback (like heuristics' `pathOf`), do **not** add a flag
  to this helper — keep that caller's own primitive. One shared helper for the
  common case, not a configurable mega-function.
- A reviewer should confirm the sort tiebreakers in both call sites are
  byte-identical to before; only the depth primitive should have changed.
