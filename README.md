# llms.txt Generator

An automated [llms.txt](https://llmstxt.org) generation and monitoring service. Paste a URL → crawl the site → produce a spec-compliant llms.txt → optionally watch the site and regenerate when content changes.

## Stack

- **UI:** Next.js (App Router) on Vercel
- **API + workers:** Cloudflare Worker (Hono) with Queues, Durable Objects, D1, R2, Cron Triggers
- **LLM:** Anthropic Claude Haiku 4.5 (refinement only; deterministic generator is the floor)

See `ARCHITECTURE.md` for the full system map.

## Local setup

Prereqs for all local modes: `pnpm`, `node ≥ 20`.

```bash
pnpm install
```

### Mock UI mode

Use this when you want to work on the web app without running Cloudflare local
infrastructure. The UI uses the in-memory mock client and simulates crawl
progress, generated files, monitoring toggles, and failure paths.

```bash
cp apps/web/.env.example apps/web/.env.local
# In apps/web/.env.local, set:
# NEXT_PUBLIC_API_MOCK=1

pnpm --filter @profound-takehome/web dev
# web: http://localhost:3000
```

Submit a URL whose hostname contains `error` to exercise the mock failure path.

### Real Wrangler local infra

Use this when you need the Worker, D1, R2, KV, Queues, Durable Objects, or API
integration behavior. Requires a Cloudflare account (free tier is enough).

```bash
# Provision Cloudflare resources (one-time)
cd apps/api
pnpm wrangler d1 create llms_txt           # → copy id into wrangler.toml
pnpm wrangler r2 bucket create llms-txt-files
pnpm wrangler kv:namespace create RATE_LIMIT   # → copy id into wrangler.toml
pnpm wrangler queues create crawl-queue
pnpm wrangler queues create monitor-queue
pnpm wrangler queues create crawl-dlq
pnpm wrangler queues create monitor-dlq

# Apply schema (local SQLite simulator)
pnpm db:migrate:local

# Set the Anthropic key (production):
pnpm wrangler secret put ANTHROPIC_API_KEY
# Or for local dev, add it to apps/api/.dev.vars (gitignored)

# Run both surfaces
cd ../..
pnpm dev
# web: http://localhost:3000
# api: http://localhost:8787
```

## Deploy

- **Web:** Vercel is connected to the GitHub repo with `apps/web` as the
  project root. Production builds need
  `NEXT_PUBLIC_API_URL=https://llms-txt-api.phillips-walter-n.workers.dev`.
- **API:** GitHub Actions deploys the Cloudflare Worker on pushes to `main`
  that touch API/shared/database files. Configure repository secrets:
  `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.

Manual API deploy:

```bash
cd apps/api
pnpm db:migrate:remote
pnpm deploy
```

## Verify

```bash
make verify
```

Runs lint, typecheck, tests, and doc checks across the workspace.

## Layout

```
apps/
  web/         Next.js UI
  api/         Cloudflare Worker (Hono + Queues + DO + cron)
    src/
      api/         Hono route modules
      crawler/     robots, sitemap, frontier, fetch, extract
      generator/   heuristics (Pass 1), LLM refine (Pass 2), render, validate
      monitor/     change detection + adaptive cadence
      do/          SiteCoordinator durable object
      queue/       queue batch consumers
      lib/         url normalization, shared helpers
packages/
  db/          Drizzle schema + D1 migrations
  shared/      zod request/response contracts
  config/      eslint + tsconfig bases
```

## Design notes

- **Graceful degradation everywhere.** Crawl: sitemap → bounded same-origin BFS. Generation: LLM → heuristics. Monitor: sitemap-diff → conditional-GET → content-hash. Every successful run produces a valid file; only quality degrades.
- **Cheapest signal first.** Never fetch a page if a sitemap diff answers the question; static HTML fetch is the crawler floor for MVP.
- **Validator gates everything.** `generator/validate.ts` runs before any R2 write. Spec compliance is a verifiable claim, not a vibe.
- **DO-per-site mutex.** SiteCoordinator owns the URL frontier, dedupes, tracks live progress, and prevents overlapping runs for the same domain — without D1 row-lock gymnastics.
- **Adaptive monitor cadence.** No hardcoded site taxonomy: priors at registration seed an interval that halves on change-found and 1.5×s on no-change. Self-corrects.
