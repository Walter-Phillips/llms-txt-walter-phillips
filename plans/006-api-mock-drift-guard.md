# Plan 006: Add a compile-time guard so the mock API client can't silently drift from the real one

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 66f82d7..HEAD -- apps/web/src/lib/api.ts apps/web/src/lib/mock-api.ts`
> If either file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch, treat
> it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `66f82d7`, 2026-06-14

## Why this matters

The web app ships two implementations of the `LlmsApi` interface: the real
`httpClient` (`apps/web/src/lib/api.ts`) and the in-memory `mockClient`
(`apps/web/src/lib/mock-api.ts`, 320 LOC) used for demos and E2E. Mock mode
(`NEXT_PUBLIC_API_MOCK=1`) drives the entire UI and the Playwright suite. Both
already implement the `LlmsApi` interface, so a _signature_ change is caught —
but the risk this closes is subtler: it's easy to add a method to `LlmsApi` and
`httpClient` and forget the mock, or vice-versa, if either is ever typed loosely.
A one-line `satisfies` assertion makes "these two clients are interchangeable" a
**compile-time** invariant, so drift fails `pnpm typecheck` instead of surfacing
as a green-tests-but-broken-prod surprise.

## Current state

```ts
// apps/web/src/lib/api.ts:23-32 — the contract
export interface LlmsApi {
  createSite(url: string): Promise<CreateSiteResponse>;
  getSite(siteId: string): Promise<SiteResponse>;
  getJob(runId: string): Promise<JobStatusResponse>;
  getVersions(siteId: string): Promise<VersionsResponse>;
  getPages(siteId: string): Promise<PagesResponse>;
  getDiff(siteId: string, from: number, to: number): Promise<DiffResponse>;
  setMonitoring(siteId: string, enabled: boolean): Promise<SiteResponse>;
  getLlmsTxt(domain: string): Promise<string>;
}

// apps/web/src/lib/api.ts:88 — real client (already typed : LlmsApi)
const httpClient: LlmsApi = { … };

// apps/web/src/lib/api.ts:117-128 — mock is dynamically imported only in mock mode
async function resolveClient(): Promise<LlmsApi> {
  …
  const { mockClient } = await import("./mock-api");
  client = mockClient;
  …
}
```

```ts
// apps/web/src/lib/mock-api.ts:247 — mock client (already typed : LlmsApi)
export const mockClient: LlmsApi = { … };
```

Both are annotated `: LlmsApi` today, so the interface is the shared contract.
What's missing is a guard that the _response schema types themselves_ line up —
i.e. that both return the exact `*Response` types from `@profound-takehome/shared`
and that no method is wider on one side. A `satisfies typeof httpClient` on the
mock (and a tiny test) makes the relationship explicit and self-documenting.

Conventions: the web package uses vitest (`apps/web/src/lib/api.test.ts`,
`apps/web/src/lib/mock-api.test.ts` exist). Tests are plain
`describe`/`it`/`expect`.

## Commands you will need

| Purpose   | Command                                          | Expected on success |
| --------- | ------------------------------------------------ | ------------------- |
| Typecheck | `pnpm --filter @profound-takehome/web typecheck` | exit 0              |
| Tests     | `pnpm --filter @profound-takehome/web test`      | all pass            |
| Full gate | `pnpm verify`                                    | exit 0              |

## Scope

**In scope** (the only files you should modify):

- `apps/web/src/lib/mock-api.ts` — add a compile-time `satisfies` assertion
  binding `mockClient` to the shape of the real client.
- `apps/web/src/lib/mock-api.test.ts` — add a test that both clients expose the
  same method-name set (a runtime backstop for the compile-time guard).

**Out of scope** (do NOT touch):

- `apps/web/src/lib/api.ts` — the contract source; do not change `LlmsApi` or
  `httpClient`.
- `@profound-takehome/shared` schemas — unchanged.
- Behavior of the mock simulation — this plan adds a guard, not a feature.

## Git workflow

- Branch: `advisor/006-mock-drift-guard`
- Commit style: conventional commits, e.g.
  `test(web): guard mock API client against contract drift`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the compile-time assertion to the mock

At the bottom of `apps/web/src/lib/mock-api.ts`, after `mockClient` is defined,
add a type-only assertion. Importing the real client's _type_ (not its value, to
avoid bundling the HTTP client into mock mode) is cleanest via a `typeof` on a
type import. Since `httpClient` is not exported, assert both directions against
the shared `LlmsApi` interface plus an explicit structural equality helper:

```ts
import type { LlmsApi } from "./api";

// Compile-time guard: mockClient must satisfy the same contract as the real
// client. Drift (a method added to LlmsApi but not here, or a wider/narrower
// signature) becomes a typecheck failure, not a green-tests-but-broken-prod
// surprise. See plan 006.
const _mockSatisfiesContract: LlmsApi = mockClient;
void _mockSatisfiesContract;
```

If `LlmsApi` is not currently exported from `api.ts`, it **is** (line 23 shows
`export interface LlmsApi`). Confirm the import resolves.

(Optional stronger guard — only if `httpClient` is exported or you export its
type: `mockClient satisfies typeof httpClient`. Do **not** export `httpClient`
just for this; the `LlmsApi` annotation already covers it.)

**Verify**: `pnpm --filter @profound-takehome/web typecheck` → exit 0.

### Step 2: Add a runtime method-parity test

In `apps/web/src/lib/mock-api.test.ts`, add a test that the mock exposes exactly
the `LlmsApi` method names. Since the interface isn't enumerable at runtime,
assert against the known method list (which is small and stable) and that the
mock has a function for each:

```ts
import { mockClient } from "./mock-api";

const METHODS = [
  "createSite",
  "getSite",
  "getJob",
  "getVersions",
  "getPages",
  "getDiff",
  "setMonitoring",
  "getLlmsTxt",
] as const;

it("mock client implements every LlmsApi method", () => {
  for (const m of METHODS) {
    expect(typeof (mockClient as Record<string, unknown>)[m]).toBe("function");
  }
});
```

**Verify**: `pnpm --filter @profound-takehome/web test -- mock-api` → all pass.

### Step 3: Prove the guard actually catches drift (temporary check)

Temporarily comment out one method (e.g. `getDiff`) in `mockClient` and run
`pnpm --filter @profound-takehome/web typecheck`. Confirm it now **fails** (the
`const _mockSatisfiesContract: LlmsApi = mockClient` line errors). Then restore
the method. This verifies the guard is load-bearing, not decorative.

**Verify**: with the method removed, typecheck **fails**; after restoring,
`pnpm --filter @profound-takehome/web typecheck` → exit 0.

### Step 4: Full gate

**Verify**: `pnpm verify` from repo root → exit 0.

## Test plan

- New test in `apps/web/src/lib/mock-api.test.ts`: method-parity check over the
  `LlmsApi` surface.
- The compile-time `satisfies`/annotation is the primary guard; Step 3 proves it
  fails on drift.
- Verification: `pnpm --filter @profound-takehome/web test` → all pass;
  `pnpm --filter @profound-takehome/web typecheck` → exit 0.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n "LlmsApi = mockClient\|satisfies typeof httpClient" apps/web/src/lib/mock-api.ts` shows the guard
- [ ] Step 3 confirmed the guard fails typecheck when a method is removed (then restored)
- [ ] `pnpm --filter @profound-takehome/web typecheck` exits 0
- [ ] `pnpm --filter @profound-takehome/web test` exits 0; the method-parity test passes
- [ ] `pnpm verify` exits 0
- [ ] `git status` shows only the two in-scope files changed
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `LlmsApi` is not exported from `apps/web/src/lib/api.ts` (the excerpt says it
  is — if it isn't, the source has drifted).
- Adding the type import creates a circular-import or bundling problem that
  pulls `httpClient` into mock-mode builds.
- The "Current state" excerpts no longer match the source.

## Maintenance notes

- This guard only proves the two clients are _type-compatible_. It does not
  prove the mock's _behavior_ matches the server's. Behavioral parity is still a
  manual/E2E concern — note it in review when response shapes change.
- If a new API method is added, the compile-time guard forces the mock to
  implement it; the runtime list in the test must be updated too (keep them in
  sync — consider deriving the test list from a single source if it grows).
