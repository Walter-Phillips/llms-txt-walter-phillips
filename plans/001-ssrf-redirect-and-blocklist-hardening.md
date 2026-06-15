# Plan 001: Crawler rejects internal/metadata targets even via redirects, IPv6, and integer-encoded IPs

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 66f82d7..HEAD -- apps/api/src/lib/url.ts apps/api/src/crawler/fetcher.ts apps/api/src/api/sites.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `66f82d7`, 2026-06-14

## Why this matters

This service crawls **arbitrary user-supplied URLs**. The product has no auth
by design, so the SSRF boundary is the only thing stopping a visitor from
pointing the Worker's `fetch` at internal infrastructure (cloud metadata at
`169.254.169.254`, link-local IPv6, loopback, RFC-1918 ranges). Today the guard
in `normalizeOrigin` only blocks **textual IPv4** private ranges and only at
**registration time** — it never re-checks the URL the crawler actually fetches
after following HTTP redirects, and it misses IPv6 loopback/link-local
(`[::1]`, `[fe80::…]`, `[fd00::…]`), IPv4-mapped IPv6 (`[::ffff:127.0.0.1]`),
and integer/octal/hex-encoded IPv4 (`http://2130706433/` = `127.0.0.1`). A
crawled page on the entered origin can also 301-redirect the fetcher to any of
those. When this lands, an internal target is rejected at registration **and**
at every fetch hop.

## Current state

- `apps/api/src/lib/url.ts` — `normalizeOrigin` (lines 7-29) is the only SSRF
  filter. It runs at registration (`api/sites.ts:19`) and is reused as one of
  the domain candidates in `api/files.ts:67`. Current blocklist:

  ```ts
  // apps/api/src/lib/url.ts:14-28
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    /^169\.254\./.test(host)
  ) {
    return null;
  }
  return `${parsed.protocol}//${host}`;
  ```

  Gaps: no IPv6 handling at all (`new URL("http://[::1]/").hostname` is `[::1]`,
  which matches none of these), no integer/hex IPv4 (`http://2130706433`),
  no `100.64.0.0/10` carrier-grade NAT, no IPv4-mapped IPv6.

- `apps/api/src/crawler/fetcher.ts` — `politeFetch` (lines 15-45) issues the
  actual outbound request with `redirect: "follow"` (line 25) and **never
  validates the final/redirected URL**:

  ```ts
  // apps/api/src/crawler/fetcher.ts:23-27
  const res = await fetch(url, {
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  ```

  `politeFetch` is called from `apps/api/src/queue/crawl-consumer.ts:300`
  (page crawl) and `apps/api/src/queue/monitor-consumer.ts:183` (conditional
  GET). `fetchRobots` (`apps/api/src/crawler/robots.ts`) and
  `discoverSitemapEntries` (`apps/api/src/crawler/sitemap.ts`) also fetch the
  origin — but they use the origin string already validated by
  `normalizeOrigin`, so the redirect gap is the live hole for those too.

- Repo conventions to match:
  - Pure URL/string logic lives in `apps/api/src/lib/url.ts`; crawl-specific
    filtering lives in `apps/api/src/crawler/`. Add the host-safety predicate to
    `lib/url.ts` (it is reused by both registration and fetch).
  - Functions are small, exported, and unit-tested. See the existing
    `apps/api/src/lib/url.test.ts` for the test style (plain vitest
    `describe`/`it`/`expect`, no mocks).
  - Error handling on the crawl path is "fail this one page, not the run":
    `crawl-consumer.ts:350-353` swallows a fetch/extract throw and calls
    `markError()`. A blocked-redirect must behave the same way — throw inside
    `politeFetch`, let the existing `try/catch` mark the page errored.

## Commands you will need

| Purpose   | Command                                          | Expected on success |
| --------- | ------------------------------------------------ | ------------------- |
| Install   | `pnpm install`                                   | exit 0              |
| Typecheck | `pnpm --filter @profound-takehome/api typecheck` | exit 0, no errors   |
| Unit test | `pnpm --filter @profound-takehome/api test`      | all pass            |
| Lint      | `pnpm --filter @profound-takehome/api lint`      | exit 0              |
| Full gate | `pnpm verify` (from repo root)                   | exit 0              |

## Scope

**In scope** (the only files you should modify):

- `apps/api/src/lib/url.ts` — add an exported `isBlockedHost(hostname: string): boolean` predicate; use it inside `normalizeOrigin`.
- `apps/api/src/lib/url.test.ts` — add cases for the new host forms.
- `apps/api/src/crawler/fetcher.ts` — validate the final response URL after redirects; throw on a blocked host.
- `apps/api/src/crawler/fetcher.test.ts` (create) — test the redirect guard.

**Out of scope** (do NOT touch, even though they look related):

- `apps/api/src/crawler/frontier.ts` — same-origin admission is a _separate_
  control; do not fold SSRF logic into it.
- `apps/api/src/api/sites.ts` / `files.ts` — they already call `normalizeOrigin`;
  hardening that function covers them. Do not add new validation there.
- The public response shapes and any DB schema — unchanged.
- DNS resolution / IP pinning: Workers `fetch` does not expose the resolved IP,
  so a DNS-rebinding defense is **out of scope** (note it in Maintenance).

## Git workflow

- Branch: `advisor/001-ssrf-hardening`
- Commit style is conventional commits — recent history uses
  `fix(crawler): …`, `feat(api): …`. Use e.g.
  `fix(crawler): reject internal hosts via redirects and encoded IPs`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add an `isBlockedHost` predicate in `lib/url.ts`

Add an exported function that recognizes the unsafe host forms the current
regex chain misses, and route `normalizeOrigin` through it. Target shape:

```ts
/** True if a hostname points at loopback/private/link-local space. */
export function isBlockedHost(hostname: string): boolean {
  let host = hostname.toLowerCase();
  // URL hostnames keep IPv6 in brackets — strip them for inspection.
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);

  if (host === "localhost" || host.endsWith(".localhost")) return true;

  // IPv6 loopback / link-local (fe80::/10) / unique-local (fc00::/7),
  // and IPv4-mapped IPv6 like ::ffff:127.0.0.1 / ::ffff:10.0.0.1.
  if (host === "::1" || host === "::") return true;
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true; // fe80::/10
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true; // fc00::/7
  const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedHost(mapped[1]!);

  // Decode integer / hex / octal IPv4 (e.g. 2130706433, 0x7f000001) to dotted
  // quad when the whole host is one numeric token, then re-check.
  const dotted = toDottedQuad(host);
  const ipv4 = dotted ?? host;
  if (
    ipv4 === "0.0.0.0" ||
    /^0\./.test(ipv4) ||
    /^127\./.test(ipv4) ||
    /^10\./.test(ipv4) ||
    /^192\.168\./.test(ipv4) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ipv4) ||
    /^169\.254\./.test(ipv4) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ipv4) // 100.64.0.0/10 CGNAT
  ) {
    return true;
  }
  return false;
}
```

Implement `toDottedQuad(host: string): string | null` as a small local helper:
return `null` unless the host is a single integer (decimal, `0x…` hex, or
`0…` octal) or a dotted quad with a numeric final part that needs no change;
when it is a bare 32-bit integer, convert with
`[(n>>>24)&255, (n>>>16)&255, (n>>>8)&255, n&255].join(".")`. Keep it
conservative: if parsing is ambiguous, return `null` (the dotted-quad regexes
below still catch normal `127.0.0.1` etc. because `ipv4` falls back to `host`).

Then change `normalizeOrigin` (lines 16-27) to delegate:

```ts
if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
const host = parsed.hostname.toLowerCase();
if (isBlockedHost(host)) return null;
return `${parsed.protocol}//${host}`;
```

**Verify**: `pnpm --filter @profound-takehome/api typecheck` → exit 0.

### Step 2: Add unit tests for the new host forms

In `apps/api/src/lib/url.test.ts`, add a `describe("normalizeOrigin SSRF guard")`
block (model the file's existing style). Assert `normalizeOrigin` returns `null`
for each of: `http://[::1]/`, `http://[fe80::1]/`, `http://[fd00::1]/`,
`http://[::ffff:127.0.0.1]/`, `http://2130706433/`, `http://0x7f000001/`,
`http://127.0.0.1/`, `http://169.254.169.254/`, `http://10.1.2.3/`,
`http://100.64.1.1/`, `ftp://example.com/`. Assert it still returns the origin
for normal public hosts: `https://example.com/path` → `https://example.com`,
`http://1.2.3.4/` → `http://1.2.3.4` (a public IP must remain allowed).

**Verify**: `pnpm --filter @profound-takehome/api test -- url` → all pass,
including the new cases.

### Step 3: Validate the post-redirect URL in `politeFetch`

In `apps/api/src/crawler/fetcher.ts`, import `isBlockedHost` from `../lib/url`,
and after the `fetch` resolves, reject if the **final** URL's host is blocked.
`Response.url` is the URL after redirects. Target shape:

```ts
import { isBlockedHost } from "../lib/url";
// …
const res = await fetch(url, {
  headers,
  redirect: "follow",
  signal: AbortSignal.timeout(TIMEOUT_MS),
});

// A page may redirect to internal space; re-check the host we actually landed on.
if (res.url) {
  const finalHost = new URL(res.url).hostname;
  if (isBlockedHost(finalHost)) {
    await res.body?.cancel();
    throw new Error(`blocked redirect to internal host: ${finalHost}`);
  }
}
```

Place this **before** the content-length handling block (current lines 29-35).
The thrown error is caught by the existing `try/catch` in
`crawl-consumer.ts:299-353` and `monitor-consumer.ts:182-203`, marking just
that page errored — confirm you are not adding a new catch.

**Verify**: `pnpm --filter @profound-takehome/api typecheck` → exit 0.

### Step 4: Test the redirect guard

Create `apps/api/src/crawler/fetcher.test.ts`. Use `vi.stubGlobal("fetch", …)`
to return a fake `Response`-like object whose `.url` is a blocked host
(e.g. `http://169.254.169.254/`) and assert `politeFetch("https://example.com")`
rejects. Add a second case where `.url` is a public host and assert it resolves
with the expected `status`. Restore the global in `afterEach`. Keep the fake
minimal: `{ url, status: 200, headers: new Headers(), body: null }`.

**Verify**: `pnpm --filter @profound-takehome/api test -- fetcher` → all pass.

### Step 5: Full gate

**Verify**: `pnpm verify` from repo root → exit 0.

## Test plan

- New tests in `apps/api/src/lib/url.test.ts`: IPv6 loopback/link-local/ULA,
  IPv4-mapped IPv6, integer/hex IPv4, CGNAT, non-http scheme, plus
  **positive** cases (public host + public IP still allowed) so the guard isn't
  over-broad.
- New file `apps/api/src/crawler/fetcher.test.ts`: blocked-redirect rejects;
  allowed-redirect resolves. Model structure after `apps/api/src/lib/url.test.ts`.
- Verification: `pnpm --filter @profound-takehome/api test` → all pass,
  including the new tests.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm --filter @profound-takehome/api typecheck` exits 0
- [ ] `pnpm --filter @profound-takehome/api test` exits 0; new url + fetcher tests pass
- [ ] `grep -n "isBlockedHost" apps/api/src/lib/url.ts apps/api/src/crawler/fetcher.ts` shows the predicate defined and used in the fetcher
- [ ] `pnpm verify` exits 0
- [ ] `git status` shows only the four in-scope files changed
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The `normalizeOrigin` body no longer matches the "Current state" excerpt
  (someone already reworked the guard — reconcile before editing).
- `Response.url` is unavailable in the Workers `fetch` runtime used by tests
  (the project's vitest runs in Node; if `res.url` is empty for real fetches in
  the Worker, the redirect check is a no-op — STOP and report so we choose a
  different signal).
- A step's verification fails twice after a reasonable fix attempt.
- Adding the guard breaks existing crawler/monitor tests in a way that implies
  legitimate public hosts are now blocked.

## Maintenance notes

- **Residual risk not closed here**: DNS rebinding (a public hostname that
  resolves to a private IP at fetch time) is not defended, because Workers
  `fetch` does not expose the resolved address. If the platform later offers an
  IP hook or a connect-time callback, pin/validate the resolved IP there.
- A reviewer should confirm `isBlockedHost` is conservative on the _positive_
  side: public IPs and normal hostnames must still pass, or every crawl breaks.
- If a future change adds a new outbound `fetch` (e.g. a webhook sender), it
  must route through `politeFetch` or call `isBlockedHost` itself — the guard is
  not global.
