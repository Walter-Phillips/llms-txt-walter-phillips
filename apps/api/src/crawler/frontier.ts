// URL filter & blocklist applied to BFS link crawl.
// Lives here, not in lib/, because rules are crawl-specific.

const PATH_BLOCKLIST = [
  /^\/search/i,
  /^\/login/i,
  /^\/cart/i,
  /^\/wp-admin/i,
  /\/page\/[3-9]\d*/i,
  /\/(?:tag|category)\/.+\/page\//i,
];

export function shouldCrawl(path: string, disallow: string[]): boolean {
  if (PATH_BLOCKLIST.some((rx) => rx.test(path))) return false;
  if (disallow.some((d) => path.startsWith(d))) return false;
  return true;
}
