# Product

## Purpose

Generate a spec-compliant [llms.txt](https://llmstxt.org) for any public website by crawling and structuring its content — and keep that file in sync as the site evolves. The "automated updates" mechanism is the differentiator: most generators produce a one-shot snapshot that goes stale within weeks.

## Users

- **Primary — observer.** Anyone who wants an llms.txt for a site they don't own, immediately and without sign-up. Paste a URL, get a downloadable file plus a stable hosted URL.
- **Secondary — site owner.** Wants the file to track their own site over time. Monitoring starts on by default, and they can reverse-proxy the hosted URL from their domain (or pull the file via the API) and trust it to stay current.

## Core Workflows

1. **Generate** — paste URL → see live progress (discovering → crawling N/M → generating) → land on a result page with the rendered llms.txt, a copy/download path, a stable hosted URL, and a page-inventory table showing what was crawled and how it was classified.
2. **Watch** — monitoring is on for newly generated sites by default and can be paused on a result. The system picks an adaptive cadence (priors from sitemap shape + RSS presence, feedback loop on whether changes are actually found) and regenerates when site structure or page metadata changes.
3. **History** — view version timeline with change summaries ("2 pages added, 1 modified"); diff any two versions inline.

## Non-Goals

- **Auth, accounts, multi-user.** Observer-first; auth is layered on later if needed.
- **Crawling at search-engine depth.** Page cap (default 1,000), depth cap (3). Bounded by design — llms.txt is curated, not exhaustive.
- **Crawling at browser scale.** Static fetch stays the default; Browser Run rendering is a budget-capped fallback for thin static/SPAs, not a full search-engine renderer.
- **Inferring brand voice or rewriting marketing copy.** The LLM pass writes a factual summary grounded in crawled content; it never invents URLs or sections.
- **Embedding full page bodies.** llms.txt links and describes; the file is metadata, not a content dump.
