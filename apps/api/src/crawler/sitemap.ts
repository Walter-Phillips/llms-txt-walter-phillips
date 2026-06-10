export type SitemapEntry = { url: string; lastmod?: string };

// TODO: handle <sitemapindex> recursively (cap 10), detect news sitemaps,
// extract <loc>+<lastmod>, cap to N URLs prioritizing shallow paths.
export async function fetchSitemap(_url: string): Promise<SitemapEntry[]> {
  return [];
}
