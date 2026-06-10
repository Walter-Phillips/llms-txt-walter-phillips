import { politeFetch, readBodyText } from "./fetcher";

export type SitemapEntry = { url: string; lastmod?: string };

export type ParsedSitemap =
  | { kind: "index"; sitemaps: string[] }
  | { kind: "urlset"; entries: SitemapEntry[]; isNews: boolean };

const MAX_CHILD_SITEMAPS = 10;
export const MAX_SITEMAP_URLS = 100;

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function parseSitemapXml(xml: string): ParsedSitemap {
  if (/<sitemapindex[\s>]/i.test(xml)) {
    const sitemaps: string[] = [];
    for (const m of xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
      sitemaps.push(decodeXmlEntities(m[1]!));
    }
    return { kind: "index", sitemaps };
  }

  const isNews = /xmlns:news=|<news:/i.test(xml);
  const entries: SitemapEntry[] = [];
  for (const block of xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
    const loc = block[1]!.match(/<loc>\s*([^<]+?)\s*<\/loc>/i)?.[1];
    if (!loc) continue;
    const lastmod = block[1]!.match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/i)?.[1];
    entries.push({ url: decodeXmlEntities(loc), ...(lastmod ? { lastmod } : {}) });
  }
  return { kind: "urlset", entries, isNews };
}

/** Shallower paths first; ties broken by URL length, then lexicographically. */
export function prioritizeShallow(entries: SitemapEntry[], cap = MAX_SITEMAP_URLS): SitemapEntry[] {
  const depth = (u: string): number => {
    try {
      return new URL(u).pathname.split("/").filter(Boolean).length;
    } catch {
      return Number.MAX_SAFE_INTEGER;
    }
  };
  return [...entries]
    .sort((a, b) => depth(a.url) - depth(b.url) || a.url.length - b.url.length || (a.url < b.url ? -1 : 1))
    .slice(0, cap);
}

export type SitemapDiscovery = {
  entries: SitemapEntry[];
  isNews: boolean;
  /** sitemap URLs that returned a 200 */
  found: string[];
};

/**
 * Fetch declared sitemaps (or conventional fallbacks), recursing into index
 * files with a hard cap on total fetches. Failures are soft — an unreachable
 * sitemap just contributes nothing.
 */
export async function discoverSitemapEntries(
  origin: string,
  declared: string[],
): Promise<SitemapDiscovery> {
  const queue = declared.length
    ? [...declared]
    : [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  const visited = new Set<string>();
  const found: string[] = [];
  const entries: SitemapEntry[] = [];
  const seenUrls = new Set<string>();
  let isNews = false;
  let fetches = 0;

  while (queue.length > 0 && fetches < MAX_CHILD_SITEMAPS) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);
    fetches++;

    let xml: string;
    try {
      const res = await politeFetch(url);
      if (res.status !== 200 || !res.body) continue;
      xml = await readBodyText(res.body);
    } catch {
      continue;
    }

    const parsed = parseSitemapXml(xml);
    found.push(url);
    if (parsed.kind === "index") {
      queue.push(...parsed.sitemaps);
    } else {
      isNews ||= parsed.isNews;
      for (const e of parsed.entries) {
        if (!seenUrls.has(e.url)) {
          seenUrls.add(e.url);
          entries.push(e);
        }
      }
      if (entries.length >= MAX_SITEMAP_URLS * 3) break; // enough raw candidates
    }
  }

  return { entries: prioritizeShallow(entries), isNews, found };
}
