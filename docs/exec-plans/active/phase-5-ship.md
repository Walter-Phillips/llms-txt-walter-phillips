# Phase 5 — Ship

What's left to take the system from "works locally" to "deployed, demoable, submitted." Companion to `llms-txt-generator.md`.

## Provision Cloudflare resources

- [ ] `wrangler login`
- [ ] `wrangler d1 create llms_txt` → paste `database_id` into `apps/api/wrangler.toml`
- [ ] `wrangler r2 bucket create llms-txt-files`
- [ ] `wrangler kv:namespace create RATE_LIMIT` → paste `id` into `apps/api/wrangler.toml`
- [ ] `wrangler queues create crawl-queue`
- [ ] `wrangler queues create monitor-queue`
- [ ] `wrangler queues create crawl-dlq`
- [ ] `wrangler queues create monitor-dlq`
- [ ] `wrangler secret put ANTHROPIC_API_KEY`
- [ ] Update `APP_ORIGIN` in `wrangler.toml` `[vars]` to the deployed Worker URL

## Deploy

- [ ] `pnpm --filter @profound-takehome/api db:migrate:remote`
- [ ] `pnpm --filter @profound-takehome/api deploy`
- [ ] Vercel: connect the repo, set root to `apps/web`, set `NEXT_PUBLIC_API_URL=https://<worker>.workers.dev`
- [ ] Confirm cron trigger is registered: `wrangler triggers list`

## Smoke-test battery

For each site: paste URL, watch progress, verify generated llms.txt at `/sites/<domain>/llms.txt`.

- [ ] Docs site with sitemap (`docs.anthropic.com` or similar)
- [ ] Blog (`vercel.com/blog` or similar) — confirms Blog section + dated-path rule
- [ ] Brochure site, no sitemap — confirms BFS path
- [ ] SPA (e.g. a Next.js demo) — confirms graceful degradation when extraction is thin (documented limitation, should still produce _something_ valid)
- [ ] Site that 403s bots — confirms friendly error surfacing
- [ ] Large site (cap behavior) — confirms page cap stops the crawl and we still ship a file

## Monitoring demo

- [ ] Enable monitoring on a small site
- [ ] Manually trigger the cron (`wrangler triggers cron-trigger`) or wait one cycle
- [ ] Edit a fixture page (or pick a site with active updates) and re-run
- [ ] Confirm v2 lands with a change summary; diff view renders

## README + demo

- [ ] Confirm `README.md` setup steps work from scratch on a clean clone
- [ ] Screenshots: landing, progress (with discovery method banner), result with copy/download, history timeline with change summary, diff view
- [ ] Short demo video (or animated screenshots): paste URL → result → toggle watch → simulate change → v2 with diff

## Repo + submission

- [ ] Rename repo to `llms-txt-walter-{lastname}` per assignment spec
- [ ] Add the 17 GitHub collaborators listed in the assignment PDF
- [ ] Final `make verify` clean
- [ ] Submit
