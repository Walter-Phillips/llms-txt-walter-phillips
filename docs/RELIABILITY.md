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
