# Observability Setup

## Context

This project is the llms.txt generator, not the Perry Law automation project.
The current runtime surface is:

- `apps/web`: Next.js on Vercel, presentation only.
- `apps/api`: Cloudflare Worker with Hono HTTP routes, D1, R2, KV, Queues,
  Durable Objects, cron, and Anthropic generation.
- Existing Cloudflare Workers Logs are enabled in `apps/api/wrangler.toml` via
  `[observability] enabled = true`.

The main operational risk is not a single request handler failing loudly. It is
silent or under-explained failure in asynchronous crawl, monitor, generation,
and publish flows.

## Recommendation

Start with Cloudflare-native structured logs, then add error tracking and longer
retention only when the core event shape is stable.

This keeps the first implementation small, avoids shipping logs directly to a
third party on every hot path, and uses the Worker platform feature already
configured for this repo. Cloudflare Workers Logs indexes JSON fields emitted
through `console.*`, so the first code change should be a typed Pino wrapper
that prints structured JSON objects consistently.

## Phase 1: Structured Worker Logging

Add `pino` to `apps/api` and create `apps/api/src/observability/logger.ts` as a
small typed wrapper around `pino/browser`. Configure Pino with
`browser.asObject = true` so Workers Logs receives queryable objects via
`console.info`, `console.warn`, and `console.error`.

Required fields:

- `level`
- `event`
- `workflow`
- `step`
- `outcome`
- `durationMs` when timing is available

Common correlation fields:

- `requestId` from `cf-ray` or generated fallback
- `queue`
- `messageType`
- `siteId`
- `runId`
- `domain`
- `route`
- `method`
- `status`

Safety rules:

- Never log secrets, prompt bodies, generated file contents, page snippets, or
  raw response bodies.
- Keep local sanitization before handing fields to Pino because Pino browser
  mode does not support Pino's server-side redaction pipeline.
- Prefer `domain` and path-level context over full URLs when query strings may
  contain sensitive data.
- Serialize errors as `{ name, message, stack }`, with stack included only for
  error-level logs.

Instrumentation points:

- Hono middleware in `apps/api/src/app.ts`:
  - request completed
  - request failed
  - status and latency
- Worker entrypoint in `apps/api/src/index.ts`:
  - queue batch start and finish
  - cron monitor enqueue start and finish
  - top-level queue/cron failure
- Site API in `apps/api/src/api/sites.ts`:
  - crawl run queued
  - monitoring toggled
- Crawl pipeline:
  - discovery claimed or skipped
  - robots and sitemap discovery outcome
  - sitemap-vs-link discovery method
  - accepted page count
  - page fetch persisted as active, unchanged, or error
  - enqueue failure leading to run error
  - generation message enqueued
- Generation pipeline:
  - generation started
  - heuristic render validated
  - LLM refinement skipped, failed, or validation-failed fallback
  - R2 publish succeeded
  - run marked done or error
- Monitor pipeline:
  - due sites enqueued by cron
  - site skipped because monitoring is off
  - active page count
  - sitemap diff counts
  - conditional check error count
  - regeneration crawl queued
  - next cadence selected

Tests:

- Unit-test error serialization and field redaction in the logger.
- Spy on `console.*` in one request middleware test.
- Spy on queue failure logging for one crawl or monitor retry path.

## Phase 2: Error Tracking

Add Sentry after Phase 1 so captured exceptions reuse the same correlation
fields and tags. Implemented with `@sentry/cloudflare`.

Implementation:

- Add `@sentry/cloudflare` to `apps/api`. Done.
- Add optional `SENTRY_DSN` to `Environment`. Done.
- Document `SENTRY_DSN` in `docs/SECURITY.md`. Done.
- Wrap the Worker export with Sentry only when `SENTRY_DSN` is configured. Done.
- Capture exceptions at top-level fetch, queue, and scheduled boundaries. Done.
- Add manual captures around external-service edges:
  - crawler fetch failures that fail a run
  - Durable Object coordination failures
  - Anthropic refinement failures
  - R2 publish failures

Do not capture expected per-page fetch misses that are already represented as
page status unless they start failing an entire run.

## Phase 3: Retention And External Log Sink

Cloudflare Workers Logs are enough for the first pass. If the project needs
retention beyond the Workers Logs window or team alerting from log queries, add
an external sink. Implemented direct optional Axiom forwarding with
`@axiomhq/js` because the user asked for Phase 3 now.

Preferred order:

1. Cloudflare Workers Logs and dashboard queries.
2. Cloudflare Logpush or Tail Workers to an external dataset.
3. Direct Axiom client calls only if Logpush/Tail Workers do not fit. Done.

If Axiom is selected:

- Use a dataset such as `llms-txt-prod`. Done via `AXIOM_DATASET`.
- Add `AXIOM_TOKEN` as a Worker secret. Done in bindings/docs; secret value is
  not committed.
- Add any Axiom dataset or org settings as non-secret vars. Done with
  `AXIOM_DATASET`, `AXIOM_EDGE_URL`, and `AXIOM_ORG_ID`.
- Ship logs outside HTTP response paths with `ctx.waitUntil`. Done through
  invocation-scoped observability context.
- Keep queue consumer logging resilient: log shipping must never prevent
  `ack()` or `retry()`. Done; Axiom ingest errors are caught and warned.

## Phase 4: Alerting And Dashboards

Initial alerts:

- Any top-level Worker error event.
- Queue retry count above a small threshold in 15 minutes.
- Crawl runs ending in `error`.
- Generation fallback rate unexpectedly high.
- Monitor cron enqueue failure.
- No successful monitor cron run for more than one expected cron interval.

Useful dashboard slices:

- request status by route
- crawl duration by run
- page fetch outcomes by domain
- generation result by `generatedBy`
- monitor checks by changes found and next interval
- queue retry events by message type

Unlike the Perry Law plan, uptime checks are relevant here because the Worker
has public HTTP surfaces. Add low-frequency checks for:

- web app homepage
- Worker `/health`
- a representative hosted `/sites/:domain/llms.txt` URL after production data
  exists

## What To Skip For Now

- Clio, Microsoft Graph, invoice-specific workflow events.
- Datadog and Grafana unless Cloudflare logs plus Sentry are insufficient.
- Browser RUM until there are real frontend error reports.
- Direct third-party log shipping before Pino structured console logs are in
  place.

## Verification

- `pnpm --filter @profound-takehome/api test`
- `pnpm --filter @profound-takehome/api typecheck`
- `make verify`
- Manual check with `wrangler tail` or the Cloudflare Observability dashboard
  after deployment to confirm JSON fields are queryable.
