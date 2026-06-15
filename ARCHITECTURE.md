# Architecture

Top-level map for the llms.txt generator.

## Stack

- **apps/web** — Next.js (App Router) → deployed to Vercel. Pure presentation; talks to the Worker via `NEXT_PUBLIC_API_URL`.
- **apps/api** — Cloudflare Worker (Hono). Owns: HTTP API, queue consumers, DO, cron. Bindings: D1, R2, KV, two Queues, one DO class.
- **packages/db** — Drizzle ORM schema + hand-rolled D1 migrations. Single source of truth for table shapes.
- **packages/shared** — zod schemas shared by API + web (request/response contracts).
- **packages/config** — eslint + tsconfig base configs.

## Boundaries

- **UI never talks to D1 or R2 directly.** All persistence flows through the Worker API. The hosted `/sites/:domain/llms.txt` route is the only direct R2-to-public path, and it goes through the Worker.
- **Queue consumers are the only writers** to `pages` and `file_versions`. The HTTP layer only writes `sites` + `crawl_runs` (registration + run kickoff). When a crawl drains successfully, pages not observed in that run are retired before generation so the active inventory matches the version being published.
- **SiteCoordinator DO owns runtime crawl state** (frontier, progress). D1 owns durable history. Don't duplicate.
- **LLM never sees URLs it didn't receive in the inventory.** Generator/llm.ts maps refined output back to known URLs only.

## Cross-cutting

- Validation: zod at the HTTP boundary, drizzle types internally.
- Abuse control: KV-backed fixed-window rate limiting protects write routes when `RATE_LIMIT_ENABLED=1`; public hosted file reads are not rate-limited by the app.
- Secrets: `wrangler secret` for the Worker; Vercel env for the web.
- Observability: Pino emits structured JSON logs through `console.*`; Cloudflare
  Workers Logs are enabled with `observability.enabled = true` in wrangler.toml.
  Optional `SENTRY_DSN` enables Sentry error tracking, and optional
  `AXIOM_TOKEN` + `AXIOM_DATASET` forwards Pino records to Axiom with
  `ctx.waitUntil`.

## Enforcement

- `make verify` runs lint + typecheck + tests + doc check.
- The spec validator (`apps/api/src/generator/validate.ts`) gates every generated file before R2 write.
- URL normalizer + section heuristics + cadence math + spec validator are unit-tested; the validator is the most important one — it makes "spec-compliant" a verifiable claim.
