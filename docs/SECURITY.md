# Security

## Rules

- Never commit secrets.
- Validate data at trust boundaries.
- Keep authentication and authorization decisions explicit.
- Document third-party service access and required environment variables.

## Environment Variables

Update this section in the same change that adds or removes a Worker binding,
secret, or web environment variable.

### Secrets And Vars

| Name                   | Runtime       | Required                                | Description                                                                                                  |
| ---------------------- | ------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `ANTHROPIC_API_KEY`    | Worker secret | Yes for real generation; no for mock UI | Enables LLM refinement; local dev reads it from `apps/api/.dev.vars`, production uses `wrangler secret put`. |
| `APP_ORIGIN`           | Worker var    | Yes                                     | Public web-app origin configured in `apps/api/wrangler.toml` `[vars]`.                                       |
| `NEXT_PUBLIC_API_URL`  | Web env       | No                                      | Worker base URL; defaults to `http://localhost:8787`.                                                        |
| `NEXT_PUBLIC_API_MOCK` | Web env       | No                                      | Set to `1` to use the in-memory mock UI instead of the Worker.                                               |

### Wrangler Bindings

| Binding            | Type                        | Required                      | Description                                                 |
| ------------------ | --------------------------- | ----------------------------- | ----------------------------------------------------------- |
| `DB`               | D1 database                 | Yes                           | Stores sites, crawl runs, pages, and file-version metadata. |
| `FILES`            | R2 bucket                   | Yes                           | Stores generated `llms.txt` versions.                       |
| `RATE_LIMIT`       | KV namespace                | Provisioned, not yet enforced | Reserved for API rate limiting.                             |
| `CRAWL_QUEUE`      | Queue producer and consumer | Yes                           | Drives discovery, page crawling, and generation jobs.       |
| `MONITOR_QUEUE`    | Queue producer and consumer | Yes                           | Drives scheduled monitoring checks.                         |
| `SITE_COORDINATOR` | Durable Object              | Yes                           | Owns in-flight crawl frontier and progress state.           |
