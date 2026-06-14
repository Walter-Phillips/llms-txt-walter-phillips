// URL filter & blocklist applied to BFS link crawl.
// Lives here, not in lib/, because rules are crawl-specific.

import { normalizeUrl } from "../lib/url";

export const MAX_PAGES = 1_000;
export const MAX_DEPTH = 3;

const PATH_BLOCKLIST = [
  /^\/search/i,
  /^\/login/i,
  /^\/cart/i,
  /^\/wp-admin/i,
  /\/page\/[3-9]\d*/i,
  /\/(?:tag|category)\/.+\/page\//i,
];

const NON_HTML_EXTENSION = /\.(png|jpe?g|gif|svg|webp|ico|css|js|mjs|json|xml|pdf|zip|gz|mp[34]|webm|woff2?|ttf|eot|txt)$/i;

export function shouldCrawl(path: string, disallow: string[]): boolean {
  if (PATH_BLOCKLIST.some((rx) => rx.test(path))) return false;
  if (NON_HTML_EXTENSION.test(path)) return false;
  if (disallow.some((d) => path.startsWith(d))) return false;
  return true;
}

/**
 * Pure frontier admission: normalize candidates against the site origin,
 * apply same-origin + robots + blocklist filters, dedupe against `seen`,
 * and enforce the page cap. Returns accepted URLs in input order.
 */
export function acceptUrls(args: {
  candidates: string[];
  baseUrl: string;
  origin: string;
  seen: ReadonlySet<string>;
  disallow: string[];
  pageBudget: number;
}): string[] {
  const accepted: string[] = [];
  const acceptedSet = new Set<string>();
  for (const candidate of args.candidates) {
    if (accepted.length >= args.pageBudget) break;
    const normalized = normalizeUrl(candidate, args.baseUrl);
    if (!normalized) continue;
    let parsed: URL;
    try {
      parsed = new URL(normalized);
    } catch {
      continue;
    }
    if (parsed.origin !== args.origin) continue;
    if (!shouldCrawl(parsed.pathname, args.disallow)) continue;
    if (args.seen.has(normalized) || acceptedSet.has(normalized)) continue;
    acceptedSet.add(normalized);
    accepted.push(normalized);
  }
  return accepted;
}
