# llms.txt Generator — Architecture & Implementation Plan

Source of truth for the system design and what's built vs. outstanding. Updated as phases land.

**Stack:** Cloudflare Workers (Hono) · Queues · Durable Objects · D1 · R2 · Cron Triggers · Anthropic API · Next.js (Vercel) · TypeScript

**Phase status:**

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Workspace pivot to CF Workers, schema, scaffolding | ✅ done |
| 1 | Crawl core (discovery cascade, extraction, DO frontier) | ✅ done |
| 2 | Generation pipeline + UI happy path | ✅ done |
| 3 | LLM refinement + UI polish | ✅ done |
| 4 | Monitoring (detection, cadence, history UI) | ✅ done |
| 5 | Ship — see `phase-5-ship.md` | ⏳ in progress |

---

## 1. Design Principles

1. **Graceful degradation everywhere.** Every path produces a valid llms.txt; quality degrades, correctness never does.
   - Crawl: sitemap → BFS link crawl → rendered fetch (SPA fallback)
   - Generation: LLM refinement → deterministic heuristics
   - Monitoring: sitemap lastmod → conditional GET (ETag/Last-Modified) → content hash
2. **Cheapest signal first.** Never fetch a page if a sitemap diff answers the question; never run a headless browser if a static fetch returns real content; never call an LLM if the call budget is exhausted (fall back to heuristics).
3. **Async by default.** The API returns instantly; crawling happens in the background via Queues. The UI polls a Durable Object for live progress.
4. **Observer-first persona.** Anyone can generate a file for any site without auth. Owner-oriented features (hosted file URL, watch/monitor) are layered on top.

---

## 2. The llms.txt Spec (target output)

Per llmstxt.org, the file is Markdown at `/llms.txt` with sections in strict order:

```markdown
# Site Name                          ← H1, required (only required section)
> One-paragraph summary              ← blockquote, key context

Free-form detail paragraphs (no headings).

## Section Name                      ← H2 groups of curated links
- [Page Title](https://url): one-line description

## Optional                          ← skippable, secondary content
- [Page Title](https://url): description
```

Generation rules we enforce:
- H1 = site name (homepage title with suffix-stripping → domain fallback)
- Blockquote = LLM-written summary of what the site *is*, grounded in crawled content
- H2 sections named the way a user would ask for things ("Documentation", "Products", "Blog") — not how the site files them
- Every link: absolute URL, human title, one-line description
- Low-value pages (legal, careers, archived posts) demoted to `## Optional`

The validator (`apps/api/src/generator/validate.ts`) checks our own output against these rules before R2 write. "Spec-compliant" is a verifiable claim, not a vibe.

---

## 3. System Architecture

```
                       ┌─────────────────────────────────────────┐
                       │            Cloudflare Worker             │
  User ──── HTTPS ────▶│  Hono API                                │
                       │  POST /api/sites  → enqueue crawl        │
                       │  GET  /api/jobs/:id → DO status proxy    │
                       │  GET  /sites/:domain/llms.txt → R2/D1    │
                       └──────┬──────────────────────┬───────────┘
                              │ enqueue              │ status
                              ▼                      ▼
                       ┌────────────┐        ┌──────────────────┐
                       │   Queues   │        │  Durable Object   │
                       │ crawl-queue│◀──────▶│  SiteCoordinator  │
                       │monitor-queue│       │ (one per domain)  │
                       └──────┬─────┘        │ frontier, dedupe, │
                              │ consumer     │ progress, locking │
                              ▼              └──────────────────┘
                       ┌────────────────────────────┐
                       │  Crawl pipeline (Worker)    │
                       │  fetch → extract → hash     │
                       └──────┬─────────────────────┘
                              ▼
        ┌─────────┐    ┌─────────────┐    ┌─────────┐
        │   D1    │    │  Generator   │    │   R2    │
        │ sites,  │───▶│ heuristics + │───▶│versioned│
        │ pages,  │    │ LLM refine   │    │llms.txt │
        │ runs    │    └─────────────┘    └─────────┘
              ▲
              │ due sites
        ┌─────┴──────┐
        │ Cron Trigger│  every 15 min → enqueue monitor jobs
        └────────────┘

  Next.js UI on Vercel ───── HTTPS ─────▶ Worker API (CORS-enabled)
```

### Component responsibilities

| Component | Role |
| --- | --- |
| **Worker (Hono)** | API surface, hosts `/sites/:domain/llms.txt`, enqueues jobs |
| **crawl-queue** | One message per page fetch. Keeps each invocation small, gives retries + DLQ |
| **SiteCoordinator DO** | One per registered domain. URL frontier, dedupe, page/depth caps, live progress, run mutex |
| **D1** | System of record: sites, pages (with hash/etag/lastmod), crawl runs, file versions |
| **R2** | Versioned llms.txt blobs (cheap, immutable history → diff UI) |
| **Cron Trigger** | `*/15 * * * *` → query D1 for due monitored sites → enqueue monitor jobs |
| **Anthropic API** | Pass-2 refinement: summary, section naming/ordering, link descriptions, Optional demotion |
| **Next.js (Vercel)** | Pure presentation. Polls API for progress; renders result/history/diff |

---

## 4. Data Model (D1)

Source of truth: `packages/db/src/schema.ts`. Migration: `packages/db/migrations/0000_init.sql`.

- `sites` — id, domain (unique), display_name, monitoring (bool), check_interval_s, next_check_at, change_streak, created_at
- `pages` — id, site_id, url (unique per site), title, description, h1, snippet, section_hint, content_hash, etag, last_modified, sitemap_lastmod, status (active/removed/error), last_seen_at
- `crawl_runs` — id, site_id, trigger (manual/monitor/initial), status (queued/crawling/generating/done/error), pages_found, pages_crawled, pages_changed, discovery_method, error, started_at, finished_at
- `file_versions` — id, site_id, run_id, version (unique per site), r2_key, change_summary, created_at

Indexes: `sites(monitoring, next_check_at)` for the cron sweep; `pages(site_id, url)` for upsert keys.

---

## 5. Crawler — Discovery Cascade

### 5.1 Stage 0: Validate & normalize  *(built — `lib/url.ts`)*
- Resolve input to an origin (`https://example.com`), reject non-http(s) schemes, localhost, private IPs, link-local (SSRF guard).

### 5.2 Stage 1: robots.txt  *(built — `crawler/robots.ts`)*
- Fetch `/robots.txt`. Extract `Sitemap:`, `Disallow:` (UA-specific + `*`), `Crawl-delay:`. Missing/malformed → polite defaults.

### 5.3 Stage 2: Sitemaps  *(built — `crawler/sitemap.ts`)*
- Fetch declared sitemaps + conventional fallbacks (`/sitemap.xml`, `/sitemap_index.xml`).
- Sitemap-index files handled recursively (cap: 10 child sitemaps).
- `<loc>` + `<lastmod>` extracted; lastmod persisted on the page row for monitoring.
- Candidate URLs capped (default 1,000), prioritizing shallow paths.

### 5.4 Stage 3: BFS link crawl  *(built — `crawler/frontier.ts` + page consumer link extraction)*
Triggered when sitemap yields fewer than 3 URLs (constant in `crawl-consumer.ts`).
- Root, same-origin only, max depth 3, page cap 1,000.
- URL normalization: strip fragments, tracking params, trailing-slash canonicalization, lowercased host.
- Path blocklist: `/search`, `/login`, `/cart`, `/wp-admin`, deep pagination.
- Respects robots disallow.

### 5.5 Stage 4: Rendered fetch (SPA fallback)  *(deferred)*
- Empty-shell detection (body text < ~200 chars) would trigger Browser Rendering for root + top-N routes.
- Dropped from MVP scope — risk/budget vs. demo value didn't favor it. Heuristic + LLM output is already strong for the vast majority of sites.

### 5.6 Per-page extraction  *(built — `crawler/extract.ts`)*
HTMLRewriter streaming pipeline:
- `<title>`, `meta[name=description]`, `og:title/description/site_name`, `link[rel=canonical]`, first `<h1>`, first substantive `<p>`
- **Content hash** = sha-256 over title + description + h1 + snippet (NOT raw HTML — boilerplate would churn hashes on every fetch)
- Outbound link extraction (same-origin) feeds the BFS frontier
- Captures response `ETag` / `Last-Modified` headers

### 5.7 Politeness & robustness  *(built — `crawler/fetcher.ts`)*
- 10 s timeout via `AbortSignal.timeout`
- 2 MB body cap (declared `content-length` short-circuit; streaming reader caps over-the-wire)
- Honest UA: `llms-txt-generator/1.0 (+https://llms-txt.example.com/about)`
- Non-HTML content-type skipped
- Per-domain stagger: page messages enqueued with `delaySeconds = floor(i / 4)` instead of a separate scheduler
- Queue retries + DLQ handle 429/503 transients

### 5.8 Crawl orchestration flow  *(built)*
1. `POST /api/sites` → upsert site row, insert run row → enqueue `{type: "discover"}` → return `runId` immediately.
2. Discover consumer: robots → sitemap → claim run on the DO (mutex check) → seed frontier → enqueue one `page` message per accepted URL.
3. Page consumer: conditional fetch → extract → hash → upsert into `pages` → report `complete` to the DO; the DO appends any newly-discovered same-origin links to the frontier (depth-capped).
4. When `inFlight === 0 && frontier.length === 0`, the DO returns `phase: "generate"` and the consumer enqueues `{type: "generate"}`.
5. Generate consumer runs the generator pipeline (§6) and writes a new `file_versions` row.
6. UI polls `GET /api/jobs/:runId` → Worker proxies DO live state when run is in flight; D1 row otherwise.

---

## 6. Generation Pipeline

### 6.1 Pass 1 — Deterministic structuring  *(built — `generator/heuristics.ts`)*
Classify every page into a candidate section by path heuristics (`/docs|/guide|/api|/reference` → Documentation, `/blog|/news` → Blog, `/pricing|/products|/features` → Products, `/about|/team|/contact` → About, fallthrough → Core Pages, legal/careers → Optional).

Within a section: rank by depth (shallower first), then metadata richness (title + description beats bare URL), then URL for determinism. Cap at 10 per section; overflow → Optional.

Homepage represented by H1 + blockquote, never as a link. Site name resolved from homepage title with suffix-stripping (`"Welcome | Acme" → "Welcome"`) → domain fallback.

**Pass 1 output alone is already a valid llms.txt.**

### 6.2 Pass 2 — LLM refinement  *(built — `generator/llm.ts`)*
Anthropic Claude (Sonnet) with forced tool use for structured output.
- Input: structured JSON inventory (site name, homepage snippet, sections, page titles/descriptions/paths). Pages capped at 1,000; long fields truncated.
- Tool schema (zod-validated): `{ summary, sections: [{ name, pages: [{ url, description }] }], optional: [...] }`.
- Output sanitized: summary trimmed to 400 chars, section names 80, descriptions 200.
- **URL allow-list:** any URL the model returns that isn't in the input inventory is silently dropped during mapping. Hallucination is structurally impossible.
- Failure (network, schema validation, sanitization rejecting too many fields) → caller falls back to Pass 1 output. The validator (§6.3) gates everything before R2 write either way.

### 6.3 Validator  *(built — `generator/validate.ts`)*
Pure function, unit-tested. Checks:
- Exactly one H1, on line 1
- Blockquote present
- No H3+ at top level
- Every list item matches `[title](https?://...): desc`
- All link URLs same-origin as the site
- `## Optional`, if present, is last and not duplicated

Runs on every generated file before it's written to R2. If the LLM-refined output fails validation, we fall back to Pass 1 and revalidate.

### 6.4 Output  *(built — `api/files.ts` + generate consumer)*
- Versioned R2 write at `{siteId}/v{n}.txt`; `file_versions` row inserted with a change summary.
- Latest served at `GET /sites/:domain/llms.txt` with `text/markdown` content-type and `cache-control: public, max-age=300`.
- A site owner can reverse-proxy this path from their own domain.

---

## 7. Monitoring & Automated Updates

### 7.1 Layered change detection  *(built — `monitor/detect.ts`)*
Each layer is a **pure function over caller-provided inputs** — the consumer owns I/O, the detect module owns logic. Trivial to unit-test.

1. **Sitemap diff** — `diffSitemap(stored, current)` returns `{ added, removed, lastmodChanged }`. One request.
2. **Conditional GETs** — `classifyConditionalGet(response, storedValidators)` returns `unchanged | modified | removed | error`. 304 is authoritative. 200 with a validator matching what we stored → server ignored the conditional headers but nothing changed. Validator-less 200 → conservatively `modified` (false positive costs one re-crawl, not a corrupt file).
3. **Content-hash compare** — `hashChanged(stored, current)` for anything actually re-fetched. Hashes are over extracted text, so boilerplate churn doesn't cause false positives.

`buildChangeSet(inputs)` folds all three layers into one `ChangeSet`. Dedupe: `added > removed > modified`; `error` outcomes are dropped (transient failures never trigger regeneration or page removal).

### 7.2 What counts as a change worth regenerating  *(built — `isRegenerationWorthy`)*
- Page added, removed, or content-hash-modified
- Threshold: any structural change OR ≥1 metadata change → regenerate
- Pure body-text drift with identical metadata → record, don't regenerate (the file links and describes pages; it doesn't embed body text)

### 7.3 Adaptive cadence  *(built — `monitor/schedule.ts`)*
- **Priors at registration:** news sitemap or RSS feed → 6 h; dated URL patterns / `/blog/` heavy → 12 h; default → 24 h; tiny brochure site → 72 h.
- **Feedback loop:** each check updates `change_streak`:
  - changes found → `interval = max(interval / 2, 1 h)`
  - no changes → `interval = min(interval * 1.5, 7 d)`
- `next_check_at = now + interval` always advances, even on quiet checks, so the cron sweep stays predictable.

### 7.4 Scheduling mechanics  *(built — `monitor/schedule.ts` cron entry + `queue/monitor-consumer.ts`)*
- Cron every 15 min → `SELECT id FROM sites WHERE monitoring=1 AND next_check_at <= ?` (capped at 100) → batch send to monitor-queue.
- Monitor consumer runs §7.1. If regeneration warranted, kicks off a `monitor`-triggered crawl run; otherwise just updates `next_check_at` and the streak. Hard cap of 30 conditional GETs per check.
- Per-site mutual exclusion via the SiteCoordinator DO mutex (no overlapping runs).

---

## 8. API Surface

```
POST   /api/sites                 { url }            → { siteId, runId }
GET    /api/sites/:id                                → site row
GET    /api/jobs/:runId                              → { run, live? }
GET    /sites/:domain/llms.txt                       → latest file (text/markdown, cacheable)
GET    /sites/:domain/versions                       → version list + change summaries
```

Routes:
- `apps/api/src/api/sites.ts` — registration + dedupe (re-registering an existing domain returns the existing site id)
- `apps/api/src/api/jobs.ts` — proxies DO live state for active runs, D1 row otherwise
- `apps/api/src/api/files.ts` — public file serving + version listing

CORS enabled on `/api/*` for the Vercel-hosted UI.

Rate limiting via KV counter on `POST /api/sites` is wired through the `RATE_LIMIT` binding — *not yet enforced in the handler*. **Phase-5 todo.**

---

## 9. UI / User Journey  *(built — `apps/web/`)*

Single-page-style Next.js app. Observer-first, zero auth.

1. **Landing (`/`)** — URL input, one-line explainer, example sites. `components/url-form.tsx`.
2. **Site page (`/sites/[siteId]`)** — drives the whole post-submit flow via `components/site-screen.tsx`:
   - **Progress** (`progress-view.tsx`) — live phase indicator polling `/api/jobs/:runId` via `lib/use-job-status.ts`. Shows discovery method ("Found sitemap with 64 URLs" vs. "No sitemap — crawling links") and pages crawled/N.
   - **Result** (`result-view.tsx`) — rendered llms.txt (`llms-text.tsx`), copy/download buttons (`copy-button.tsx`), stable hosted URL, page-inventory table (`page-inventory.tsx`).
   - **History** (`history-view.tsx`) — version timeline with change summaries; click any two → unified diff view (`diff-view.tsx`, logic in `lib/diff.ts`). *Demo money-shot for monitoring.*

The `NEXT_PUBLIC_API_MOCK=1` env flag swaps in `lib/mock-api.ts` so the UI can be developed and demoed without a live backend. URLs whose hostname contains "error" exercise the failure path.

---

## 10. Repo & Project Structure

```
apps/
  web/                Next.js UI (Vercel)
  api/                Cloudflare Worker (Hono + Queues + DO + cron)
    src/
      api/            Hono routes (sites, jobs, files)
      crawler/        robots, sitemap, frontier, fetcher, extract
      generator/      heuristics (Pass 1), llm (Pass 2), render, validate, orchestrator
      monitor/        change detection + adaptive cadence
      do/             SiteCoordinator durable object
      queue/          crawl + monitor batch consumers
      lib/            url normalization, shared helpers
packages/
  db/                 Drizzle schema + D1 migrations
  shared/             zod request/response contracts (used by API + web)
  ui/                 shared React primitives
  config/             eslint + tsconfig bases
docs/
  PRODUCT.md          product framing
  ARCHITECTURE.md     boundaries + enforcement
  exec-plans/active/  this file + ship plan
```

---

## 11. Implementation Phases

**Phase 0 — Workspace pivot** *(done)*
Switched apps/api from Node Hono to Cloudflare Workers. Added wrangler.toml with D1/R2/KV/Queues/DO bindings, drizzle schema + migration, module skeleton, docs.

**Phase 1 — Crawl core** *(done)*
robots/sitemap/frontier/fetcher/extract modules with unit tests. SiteCoordinator DO with claim/seed/complete/finish RPCs. Crawl consumer (`discover` → `page` → drain → enqueue `generate`). End-to-end: paste a sitemap'd docs site → pages land in D1.

**Phase 2 — Generation + minimal UI** *(done)*
Pass-1 heuristics + renderer + spec validator. R2 versioned writes. Hosted `/sites/:domain/llms.txt`. Landing → progress → result page wired to the Worker.

**Phase 3 — LLM refinement + polish** *(done)*
Anthropic structured-output call with strict URL allow-listing, validator-gated, heuristic fallback on any failure. Page-inventory table, copy/download, mock API for demo/dev, friendly error states.

*Browser Rendering SPA fallback dropped from MVP — see §5.5.*

**Phase 4 — Monitoring** *(done)*
Layered detection (sitemap-diff → conditional-GET → content-hash) as pure functions. Adaptive cadence + cron sweep. Monitor consumer kicks off monitor-triggered crawl runs when changes warrant it. Version timeline + diff view in the UI.

**Phase 5 — Ship** *(in progress, see `phase-5-ship.md`)*
Provision CF resources, deploy, smoke-test, demo video, README polish, repo + collaborators.

---

## 12. Risks & Mitigations

| Risk | Mitigation | Where it lives |
| --- | --- | --- |
| Worker CPU limits on big pages | HTMLRewriter streaming, 2 MB cap, one page per queue message | `crawler/extract.ts`, `crawler/fetcher.ts` |
| Sites blocking bot UA (403) | Honest UA + clear error surfaced to user (no UA spoofing) | `crawler/fetcher.ts` + `progress-view` error states |
| Sitemap lies (stale/bumped lastmod) | Content hash is the truth; lastmod is only a prioritization hint | `monitor/detect.ts` |
| LLM hallucinating URLs/sections | URL allow-list at output mapping; validator gates output; heuristic fallback | `generator/llm.ts`, `generator/validate.ts` |
| Queue consumer storms a domain | DO frontier + per-message `delaySeconds` stagger | `do/site-coordinator.ts`, `queue/crawl-consumer.ts` |
| Duplicate concurrent runs per site | DO mutex via `/claim` (409 if another run is in flight); domain dedupe at registration | `do/site-coordinator.ts`, `api/sites.ts` |
| Infinite URL spaces (calendars, facets) | Page cap, depth cap, param stripping, path blocklists | `crawler/frontier.ts`, `lib/url.ts` |

---

## 13. Interview Talking Points (trade-offs to own)

- **Why deterministic generation as the floor?** Availability: LLM outage/cost never breaks the product. Also makes LLM value measurable — toggle the pass off, compare outputs.
- **Why content-hash over raw-HTML hash?** Boilerplate churn → false positives → wasted regeneration. Hash is over the same fields that go into the file.
- **Why a URL allow-list rather than trusting the LLM?** Hallucinated links would silently break llms.txt for consumers. Allow-list is one filter step that makes hallucination structurally impossible.
- **Why adaptive cadence over fixed categories?** Self-correcting, no taxonomy to maintain. Priors still encode domain knowledge — they just seed the feedback loop instead of ruling it.
- **Why DO-per-site?** Natural unit of mutual exclusion, URL frontier state, and live progress. Avoids D1 row-lock gymnastics for what is really runtime coordination, not durable state.
- **Why Queues over a single long task?** Worker CPU limits, free retries + DLQ, instant API response. Plus per-message `delaySeconds` gives us politeness without a separate scheduler.
- **Why drop Browser Rendering SPA fallback?** Risk/budget vs. demo value. The vast majority of sites worth running llms.txt for are server-rendered or hybrid; SPA-only sites are a known limitation, not a stealth bug.
- **Why pure functions in `monitor/detect.ts`?** I/O lives in the consumer; logic lives in the module. Unit tests cover the interesting permutations (304 with mismatched ETag, validator-less 200, removed via 410, etc.) without mocking `fetch`.
