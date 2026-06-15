# llms.txt Generator

An automated [llms.txt](https://llmstxt.org) generation and monitoring service. Paste a URL → crawl the site → produce a spec-compliant llms.txt → optionally watch the site and regenerate when content changes.

<img width="1512" height="950" alt="Screenshot 2026-06-15 at 10 53 58 AM" src="https://github.com/user-attachments/assets/ea89664b-d4c6-4d70-8d8a-8ff55f29bc7e" />
Home Page

<img width="1512" height="946" alt="Screenshot 2026-06-15 at 10 54 28 AM" src="https://github.com/user-attachments/assets/7634b556-f162-41e0-9cc6-d522cb3f2cf0" />
Progress Page

<img width="1512" height="948" alt="Screenshot 2026-06-15 at 10 55 24 AM" src="https://github.com/user-attachments/assets/2b4177f3-c399-449e-b884-3b6f925ab2fa" />
Generated llms.txt Page

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

Enable the pre-commit hook (runs `make verify` before each commit):

```bash
git config core.hooksPath .githooks
```

### Mock UI mode

Use this when you want to work on the web app without running Cloudflare local
infrastructure. The UI uses the in-memory mock client and simulates crawl
progress, generated files, monitoring toggles, and failure paths.

```bash
cp apps/web/.env.example apps/web/.env.local
# In apps/web/.env.local, set:
# NEXT_PUBLIC_API_MOCK=1
# NEXT_PUBLIC_SITE_URL=http://localhost:3000

pnpm --filter @profound-takehome/web dev
# web: http://localhost:3000
```

Submit a URL whose hostname contains `error` to exercise the mock failure path.

### Real Wrangler local infra

Use this when you need the Worker, D1, R2, KV, Queues, Durable Objects, or API
integration behavior. Requires a Cloudflare account (free tier is enough).

```bash
pnpm --filter @profound-takehome/api wrangler login

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

# Add local Worker secrets and optional observability settings.
cp .env.example .dev.vars
# Edit .dev.vars and set ANTHROPIC_API_KEY.

# Set production secrets separately:
pnpm wrangler secret put ANTHROPIC_API_KEY

# Run both surfaces
cd ../..
cp apps/web/.env.example apps/web/.env.local
# In apps/web/.env.local, keep NEXT_PUBLIC_API_MOCK=0 and
# NEXT_PUBLIC_API_URL=http://localhost:8787.
pnpm dev
# web: http://localhost:3000
# api: http://localhost:8787
```

## Deploy

### Web on Vercel

Create a Vercel project with `apps/web` as the project root. Production
environment variables:

```bash
NEXT_PUBLIC_API_URL=https://llms-txt-api.phillips-walter-n.workers.dev
NEXT_PUBLIC_API_MOCK=0
NEXT_PUBLIC_SITE_URL=https://llms-txt-web.vercel.app
```

If you deploy to different URLs, update both `NEXT_PUBLIC_API_URL` in Vercel and
`APP_ORIGIN` in `apps/api/wrangler.toml` before deploying the Worker.

### API on Cloudflare

GitHub Actions deploys the Cloudflare Worker on pushes to `main` that touch
API/shared/database files. Configure repository secrets:
`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.

Before the first production deploy:

```bash
cd apps/api
pnpm wrangler d1 create llms_txt
pnpm wrangler r2 bucket create llms-txt-files
pnpm wrangler kv:namespace create RATE_LIMIT
pnpm wrangler queues create crawl-queue
pnpm wrangler queues create monitor-queue
pnpm wrangler queues create crawl-dlq
pnpm wrangler queues create monitor-dlq
pnpm wrangler secret put ANTHROPIC_API_KEY
```

Copy the D1 database id and KV namespace id into `apps/api/wrangler.toml`.
Optional production settings are documented in `apps/api/.env.example` and
`docs/SECURITY.md`; set `SENTRY_DSN` and `AXIOM_TOKEN` with
`wrangler secret put`, and set non-secret vars in `wrangler.toml`.

Manual API deploy:

```bash
cd apps/api
pnpm db:migrate:remote
pnpm deploy
```

After deployment, point Vercel's `NEXT_PUBLIC_API_URL` at the Worker URL and
confirm the app can generate a file, open `/generations`, and fetch a hosted
`/sites/:domain/llms.txt` file.

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

- **Graceful degradation everywhere.** Crawl: sitemap → bounded same-origin BFS with cached-link replay. Generation: LLM → heuristics. Monitor: sitemap-diff → conditional-GET → content-hash. Every successful run produces a valid file; only quality degrades.
- **Cheapest signal first.** Prefer sitemap hints and HTTP revalidation before downloading bodies; static HTML fetch is the crawler floor, with budget-capped Browser Run rendering only when static extraction is thin.
- **Validator gates everything.** `generator/validate.ts` runs before any R2 write. Spec compliance is a verifiable claim, not a vibe.
- **DO-per-site mutex.** SiteCoordinator owns the URL frontier, dedupes, tracks live progress, and prevents overlapping runs for the same domain — without D1 row-lock gymnastics.
- **Adaptive monitor cadence.** No hardcoded site taxonomy: priors at registration seed an interval that halves on change-found and 1.5×s on no-change. Self-corrects.
