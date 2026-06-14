# Reliability

## Expectations

- Local startup should be deterministic.
- Logs should explain failures without requiring debugger access.
- External services should have typed, validated boundaries.

## Operational Notes

- Mock UI mode: set `NEXT_PUBLIC_API_MOCK=1` in `apps/web/.env.local` and run
  `pnpm --filter @profound-takehome/web dev`. This starts only the Next.js app
  on port 3000 and uses the in-memory API simulator; no Worker, D1, R2, KV, or
  Queue state is exercised.
- Real local infra: run `pnpm dev` from the repo root after provisioning
  Wrangler resources and applying the local D1 migration with
  `pnpm --filter @profound-takehome/api db:migrate:local`. Next.js listens on
  port 3000 and Wrangler listens on port 8787.
- The web app defaults `NEXT_PUBLIC_API_URL` to `http://localhost:8787` when
  mock mode is disabled. If the Worker is not running, API-backed UI flows fail
  fast rather than falling back to mock data.
- Mock-only behavior is intentionally limited to UI development and demos; use
  Wrangler local infra for persistence, bindings, queue, Durable Object, and
  request/response integration checks.

## Crawl Discovery

- Sitemap discovery starts from `robots.txt` declarations and falls back to
  `/sitemap.xml` plus `/sitemap_index.xml` when those declarations are missing
  or stale.
- Supported sitemap sources are XML `urlset`, XML `sitemapindex` with recursive
  child fetching, plain text URL lists, RSS/Atom feeds, and `.gz` sitemap bodies.
- Page fetches keep the small default body cap; sitemap fetches use a separate
  protocol-sized cap so large partitioned sitemaps can still seed the bounded
  crawl frontier.
- Crawl admission and LLM refinement input are capped at 1,000 pages per run.
