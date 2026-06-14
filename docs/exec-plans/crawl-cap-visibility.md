# Crawl Cap Visibility Spike

## Recommendation

Start with one user-facing cap reason: `max_pages`. It is actionable and easy to
explain: the crawler found more crawlable URLs than the configured 1,000-page
budget. Defer `max_depth`; links beyond depth 3 are often low-value and can be
noisy without a skipped-count model.

## Data Flow

The SiteCoordinator detects budget exhaustion while admitting URLs. It stores a
run-local cap flag in Durable Object state and includes it in completion
responses. When the crawl drains, the consumer persists `cap_reason =
"max_pages"` on `crawl_runs`. Shared contracts expose `capReason` on run/job
responses. The result view reads the completed run for the latest version and
shows a small note when `capReason === "max_pages"`.

## Schema

Add nullable `crawl_runs.cap_reason`. Existing rows remain `NULL`, which the UI
treats as no cap signal.

## Open Questions

- Should the DO track skipped candidate counts, or is reason-only enough?
- Should `max_depth` become user-visible after real examples prove it is useful?
- If the page cap becomes configurable, the UI copy must render the actual cap
  rather than a hardcoded default.
