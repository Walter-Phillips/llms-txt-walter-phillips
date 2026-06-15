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

const NON_HTML_EXTENSION =
  /\.(png|jpe?g|gif|svg|webp|ico|css|js|mjs|json|xml|pdf|zip|gz|mp[34]|webm|woff2?|ttf|eot|txt)$/i;

/**
 * Check whether a path is eligible for HTML crawling.
 *
 * @param path - URL path to evaluate.
 * @param disallow - Robots disallow prefixes for the site.
 * @returns Whether the path should be crawled.
 */
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
 *
 * @param options - Frontier admission inputs.
 * @param options.candidates - Raw href values to normalize and filter.
 * @param options.baseUrl - Page URL used to resolve relative candidates.
 * @param options.origin - Required site origin for accepted URLs.
 * @param options.seen - URLs already admitted in previous crawl steps.
 * @param options.disallow - Robots disallow prefixes.
 * @param options.pageBudget - Maximum number of URLs to accept.
 * @returns Accepted canonical URLs in input order.
 */
export function acceptUrls(options: {
  candidates: string[];
  baseUrl: string;
  origin: string;
  seen: ReadonlySet<string>;
  disallow: string[];
  pageBudget: number;
}): string[] {
  const accepted: string[] = [];
  const acceptedSet = new Set<string>();
  for (const candidate of options.candidates) {
    if (accepted.length >= options.pageBudget) break;
    const normalized = normalizeUrl(candidate, options.baseUrl);
    if (!normalized) continue;
    let parsed: URL;
    try {
      parsed = new URL(normalized);
    } catch {
      continue;
    }
    if (parsed.origin !== options.origin) continue;
    if (!shouldCrawl(parsed.pathname, options.disallow)) continue;
    if (options.seen.has(normalized) || acceptedSet.has(normalized)) continue;
    acceptedSet.add(normalized);
    accepted.push(normalized);
  }
  return accepted;
}
