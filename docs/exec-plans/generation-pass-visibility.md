# Generation Pass Visibility Spike

## Recommendation

Record the outcome per file version as `generatedBy: "heuristic" |
"llm-refined"`. This belongs on `file_versions` because it describes the
published file, not the crawl run.

## Data Flow

`generate()` starts with `generatedBy = "heuristic"`. The only branch that flips
it to `"llm-refined"` is the successful refined render that passes validation.
The value is written with the `file_versions` row, exposed through shared
contracts, and rendered as a small badge near the generated file metadata.

## Open Questions

- Do operators need a private skip reason such as missing key, provider error,
  null refinement, or validation miss?
- Should users be able to force heuristic-only or LLM-refined generation? Defer
  this; the current always-try/fallback behavior is the right default.
- Should historical rows be backfilled? The nullable field avoids needing that
  now, and the UI should hide the badge for unknown rows.
