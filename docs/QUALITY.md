# Quality

## Quality Bar

- Tests cover critical behavior.
- Type checks pass without suppressions.
- Lint findings are resolved or documented.
- User-facing flows are verified before merge.

## Scorecard

| Area             | Grade | Notes                                                                                                                                                                                                                          |
| ---------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Product behavior | Good  | Generate, Watch, and History workflows are wired end-to-end; SPA-only rendered fetching remains a known non-goal for MVP.                                                                                                      |
| Architecture     | Good  | Boundaries are clear across web, Worker, shared contracts, and storage; the spec validator gates generated file writes.                                                                                                        |
| Tests            | Fair  | Core parsing, crawling, monitoring, generator, API, and UI behavior have coverage; Durable Object and full generation-pipeline coverage are still thinner. Optional live toscrape probes cover scraper regressions outside CI. |
| Documentation    | Good  | Product, architecture, reliability, security, and quality docs now describe the current operating model and known gaps.                                                                                                        |

## Manual Scraping Probe

- Run `pnpm test:toscrape:live` after substantial crawler or generator changes
  when network access is available.
- This probe fetches live Books and Quotes to Scrape pages, exercises static
  extraction, frontier normalization, and llms.txt rendering, and documents the
  current static-fetch limitation for JavaScript-rendered quote bodies.
- The probe is intentionally excluded from `pnpm test` and `make verify` so CI
  does not depend on external network availability or live site stability.
