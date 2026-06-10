export type RobotsRules = {
  disallow: string[];
  crawlDelayMs: number;
  sitemaps: string[];
};

// TODO: streaming parse. Lines: `User-agent:`, `Disallow:`, `Allow:`,
// `Crawl-delay:`, `Sitemap:`. Apply rules for our UA and `*`.
export async function fetchRobots(_origin: string): Promise<RobotsRules> {
  return { disallow: [], crawlDelayMs: 500, sitemaps: [] };
}
