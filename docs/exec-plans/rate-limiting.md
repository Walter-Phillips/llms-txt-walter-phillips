# Rate Limiting Spike

## Recommendation

Limit unauthenticated write routes only:

- `POST /api/sites` because it creates crawl runs and queue work.
- `PATCH /api/sites/:id/monitoring` because it mutates monitoring state.

Do not limit hosted file reads under `/sites/:domain/llms.txt`. That route is
intended for cross-origin clients and proxies, and Worker/R2 cache headers are
the better shield for high read traffic.

## Algorithm

Use a fixed-window KV counter keyed by route class, client IP, and window:
`rl:<route-class>:<ip>:<window>`. The initial proposal is 10 write requests per
minute per IP, with `expirationTtl` equal to the window length. The middleware
returns `429` with JSON `{ "error": "rate_limited" }` and a `Retry-After`
header when the counter is over the limit.

The limiter must fail open. If KV `get` or `put` throws, the request is allowed
so a RATE_LIMIT outage cannot take down the public API.

## Caveats

Cloudflare KV is eventually consistent across locations, so short multi-edge
bursts can undercount. That is acceptable here because this is abuse protection,
not billing enforcement. If exact limits become necessary, use Cloudflare Rate
Limiting rules or a Durable Object backed limiter.

## Open Questions

- Should limits remain route-class based or split `POST /api/sites` and
  monitoring toggles?
- Do operators need an IP allowlist for demos or internal testing?
- Should there also be a per-domain crawl cap so one IP cannot repeatedly crawl
  the same expensive target?
