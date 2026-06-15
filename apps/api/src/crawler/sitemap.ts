import { politeFetch, readBodyText } from "./fetcher";
import { urlPathDepth } from "../lib/url";

export interface SitemapEntry {
  url: string;
  lastmod?: string;
}

export type ParsedSitemap =
  | { kind: "index"; sitemaps: string[] }
  | { kind: "urlset"; entries: SitemapEntry[]; isNews: boolean };

const DEFAULT_MAX_SITEMAP_FETCHES = 10;
const MAX_SITEMAP_BYTES = 50 * 1024 * 1024;
const MAX_SITEMAP_URLS = 1_000;

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function cleanXmlText(s: string): string {
  return decodeXmlEntities(
    s
      .trim()
      .replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i, "$1")
      .trim(),
  );
}

function matchElementText(fragment: string, localName: string): string | undefined {
  const rx = new RegExp(
    `<(?:[\\w.-]+:)?${localName}\\b[^>]*>\\s*([\\s\\S]*?)\\s*<\\/(?:[\\w.-]+:)?${localName}>`,
    "i",
  );
  const match = fragment.match(rx)?.[1];
  return match === undefined ? undefined : cleanXmlText(match);
}

function matchAttribute(tag: string, attribute: string): string | undefined {
  const rx = new RegExp(`\\s${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
  const match = tag.match(rx);
  const value = match?.[1] ?? match?.[2];
  return value === undefined ? undefined : decodeXmlEntities(value.trim());
}

function parseUrlEntries(xml: string): SitemapEntry[] {
  const entries: SitemapEntry[] = [];
  for (const block of xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)) {
    const loc = matchElementText(block[1], "loc");
    if (!loc) continue;
    const lastmod = matchElementText(block[1], "lastmod");
    entries.push({ url: loc, ...(lastmod ? { lastmod } : {}) });
  }
  return entries;
}

function parseRssEntries(xml: string): SitemapEntry[] {
  const entries: SitemapEntry[] = [];
  for (const block of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const loc = matchElementText(block[1], "link") ?? matchElementText(block[1], "guid");
    if (!loc) continue;
    const lastmod = matchElementText(block[1], "lastmod") ?? matchElementText(block[1], "pubDate");
    entries.push({ url: loc, ...(lastmod ? { lastmod } : {}) });
  }
  return entries;
}

function parseAtomEntries(xml: string): SitemapEntry[] {
  const entries: SitemapEntry[] = [];
  for (const block of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)) {
    const loc = preferredAtomLink(block[1]);
    if (!loc) continue;
    const lastmod = matchElementText(block[1], "updated") ?? matchElementText(block[1], "modified");
    entries.push({ url: loc, ...(lastmod ? { lastmod } : {}) });
  }
  return entries;
}

function preferredAtomLink(entryXml: string): string | undefined {
  let loc: string | undefined;
  for (const linkTag of entryXml.matchAll(/<link\b[^>]*>/gi)) {
    const tag = linkTag[0];
    const href = matchAttribute(tag, "href");
    if (!href) continue;

    const relationship = matchAttribute(tag, "rel");
    const isAlternate = relationship?.toLowerCase() === "alternate";
    if (!loc || relationship === undefined || isAlternate) loc = href;
    if (isAlternate) break;
  }
  return loc;
}

function parseSitemapText(text: string): SitemapEntry[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^https?:\/\//i.test(line))
    .map((url) => ({ url }));
}

/**
 * Parse XML sitemap, sitemap index, RSS, or Atom content.
 *
 * @param xml - XML document text.
 * @returns Parsed sitemap index or URL entries.
 */
export function parseSitemapXml(xml: string): ParsedSitemap {
  if (/<sitemapindex\b/i.test(xml)) {
    const sitemaps: string[] = [];
    for (const block of xml.matchAll(/<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/gi)) {
      const loc = matchElementText(block[1], "loc");
      if (loc) sitemaps.push(loc);
    }
    return { kind: "index", sitemaps };
  }

  const isNews = /xmlns:news=|<news:/i.test(xml);
  let entries = parseUrlEntries(xml);
  if (entries.length === 0 && /<rss\b|<rdf:RDF\b/i.test(xml)) {
    entries = parseRssEntries(xml);
  }
  if (entries.length === 0 && /<feed\b/i.test(xml)) {
    entries = parseAtomEntries(xml);
  }
  return { kind: "urlset", entries, isNews };
}

/**
 * Parse either XML sitemap content or a plain-text URL list.
 *
 * @param text - Sitemap document body.
 * @returns Parsed sitemap index or URL entries.
 */
export function parseSitemapDocument(text: string): ParsedSitemap {
  if (text.trimStart().startsWith("<")) return parseSitemapXml(text);
  return { kind: "urlset", entries: parseSitemapText(text), isNews: false };
}

/**
 * Shallower paths first; ties broken by URL length, then lexicographically.
 *
 * @param entries - Candidate sitemap URLs.
 * @param cap - Maximum number of entries to return.
 * @returns Prioritized entries capped to the requested limit.
 */
export function prioritizeShallow(entries: SitemapEntry[], cap = MAX_SITEMAP_URLS): SitemapEntry[] {
  return [...entries]
    .sort(
      (a, b) =>
        urlPathDepth(a.url) - urlPathDepth(b.url) ||
        a.url.length - b.url.length ||
        (a.url < b.url ? -1 : 1),
    )
    .slice(0, cap);
}

export interface SitemapDiscovery {
  entries: SitemapEntry[];
  isNews: boolean;
  /** sitemap URLs that returned a 200 */
  found: string[];
}

export interface SitemapDiscoveryOptions {
  /** Hard cap on sitemap/index/feed fetches across declared and fallback URLs. */
  maxFetches?: number;
  /** Number of URLs returned after prioritization. */
  maxUrls?: number;
  /** Try /sitemap.xml and /sitemap_index.xml when declared sitemaps are absent/stale. */
  includeConventionalFallbacks?: boolean;
}

/**
 * Fetch declared sitemaps (or conventional fallbacks), recursing into index
 * files with a hard cap on total fetches. Failures are soft — an unreachable
 * sitemap just contributes nothing.
 *
 * @param origin - Site origin used for conventional fallback URLs.
 * @param declared - Sitemap URLs declared by robots.txt.
 * @param options - Discovery limits and fallback behavior.
 * @returns Prioritized sitemap entries plus discovery metadata.
 */
export async function discoverSitemapEntries(
  origin: string,
  declared: string[],
  options: SitemapDiscoveryOptions = {},
): Promise<SitemapDiscovery> {
  const maxUrls = options.maxUrls ?? MAX_SITEMAP_URLS;
  const state: DiscoveryState = {
    visited: new Set<string>(),
    found: [],
    entries: [],
    seenUrls: new Set<string>(),
    isNews: false,
    fetches: 0,
    maxFetches: options.maxFetches ?? DEFAULT_MAX_SITEMAP_FETCHES,
    rawCandidateLimit: maxUrls * 3,
  };

  await drainSitemapQueue([...declared], state);

  // If the declared sitemaps yielded nothing (e.g. a robots.txt that declares a
  // stale/404ing sitemap URL), fall back to the conventional paths that we have
  // not already fetched. The sitemap fetch budget is shared across passes.
  if (state.entries.length === 0 && options.includeConventionalFallbacks !== false) {
    const conventional = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`].filter(
      (u) => !state.visited.has(u),
    );
    await drainSitemapQueue(conventional, state);
  }

  return {
    entries: prioritizeShallow(state.entries, maxUrls),
    isNews: state.isNews,
    found: state.found,
  };
}

interface DiscoveryState {
  visited: Set<string>;
  found: string[];
  entries: SitemapEntry[];
  seenUrls: Set<string>;
  isNews: boolean;
  fetches: number;
  maxFetches: number;
  rawCandidateLimit: number;
}

/**
 * Fetch/parse every URL reachable from `seed`, recursing into index files,
 * accumulating into the shared `state`. Respects the global MAX_CHILD_SITEMAPS
 * fetch budget and is soft-failing — unreachable URLs contribute nothing.
 *
 * @param seed - Initial sitemap URLs to visit.
 * @param state - Mutable discovery state shared across queue passes.
 */
async function drainSitemapQueue(seed: string[], state: DiscoveryState): Promise<void> {
  const queue = [...seed];

  while (queue.length > 0 && state.fetches < state.maxFetches) {
    const url = queue.shift();
    if (url === undefined) break;
    if (state.visited.has(url)) continue;

    const bodyText = await fetchSitemapText(url, state);
    if (bodyText === null) continue;

    const parsed = parseSitemapDocument(bodyText);
    state.found.push(url);
    if (parsed.kind === "index") {
      queue.push(...parsed.sitemaps);
    } else {
      collectSitemapEntries(parsed, state);
      if (state.entries.length >= state.rawCandidateLimit) break; // enough raw candidates
    }
  }
}

async function fetchSitemapText(url: string, state: DiscoveryState): Promise<string | null> {
  state.visited.add(url);
  state.fetches++;

  try {
    const res = await politeFetch(url, { maxBodyBytes: MAX_SITEMAP_BYTES });
    if (res.status !== 200 || !res.body) return null;
    return await readSitemapText(url, {
      body: res.body,
      contentType: res.contentType,
      contentEncoding: res.contentEncoding,
    });
  } catch {
    return null;
  }
}

function collectSitemapEntries(
  parsed: Extract<ParsedSitemap, { kind: "urlset" }>,
  state: DiscoveryState,
): void {
  state.isNews ||= parsed.isNews;
  for (const entry of parsed.entries) {
    if (state.seenUrls.has(entry.url)) continue;
    state.seenUrls.add(entry.url);
    state.entries.push(entry);
  }
}

async function readSitemapText(
  url: string,
  res: {
    body: ReadableStream<Uint8Array>;
    contentType: string | null;
    contentEncoding?: string | null;
  },
): Promise<string> {
  let body = res.body;
  if (shouldDecompressGzip(url, res)) {
    const gzipStream = new DecompressionStream("gzip") as unknown as ReadableWritablePair<
      Uint8Array,
      Uint8Array
    >;
    body = body.pipeThrough(gzipStream);
  }
  return readBodyText(body, MAX_SITEMAP_BYTES);
}

function shouldDecompressGzip(
  url: string,
  res: { contentType: string | null; contentEncoding?: string | null },
): boolean {
  const contentEncoding = res.contentEncoding?.toLowerCase() ?? "";
  if (contentEncoding.includes("gzip")) return false;

  const contentType = res.contentType?.toLowerCase() ?? "";
  const path = url.split(/[?#]/, 1)[0].toLowerCase();
  return path.endsWith(".gz") || /application\/(?:x-)?gzip/.test(contentType);
}
