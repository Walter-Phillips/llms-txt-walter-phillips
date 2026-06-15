import type { Inventory, InventoryPage, SectionInventory } from "@profound-takehome/shared";

export type { InventoryPage, SectionInventory, Inventory } from "@profound-takehome/shared";

/** Subset of a D1 `pages` row the heuristics need. Pure-data input. */
export interface PageRow {
  url: string;
  title: string | null;
  description: string | null;
  h1: string | null;
  snippet: string | null;
  sectionHint: string | null;
}

export const MAX_LINKS_PER_SECTION = 10;

const RULES: { rx: RegExp; section: string; optional?: boolean }[] = [
  {
    rx: /^\/(docs|documentation|guide|guides|api|reference|developers?|sdk)/i,
    section: "Documentation",
  },
  { rx: /^\/(blog|news|articles|posts|changelog|releases)/i, section: "Blog" },
  { rx: /^\/\d{4}\/\d{2}\//, section: "Blog" },
  { rx: /^\/(pricing|plans|products?|features|solutions|integrations)/i, section: "Products" },
  { rx: /^\/(about|team|contact|company|customers|case-studies)/i, section: "About" },
  { rx: /^\/(support|help|faq)/i, section: "Documentation" },
  {
    rx: /^\/(legal|privacy|terms|cookies|careers|jobs|press|media)/i,
    section: "Optional",
    optional: true,
  },
];

// Pass 1: deterministic classify. Pass 2 (LLM) renames/reorders sections.
/**
 * Classify a URL path into the first-pass inventory section.
 * @param path URL pathname to classify.
 * @returns Section metadata for the path.
 */
export function classify(path: string): { section: string; optional: boolean } {
  for (const r of RULES) {
    if (r.rx.test(path)) return { section: r.section, optional: !!r.optional };
  }
  return { section: "Core Pages", optional: false };
}

/** Deterministic ordering for Pass 1 sections; unknown names sort after, alphabetically. */
const SECTION_ORDER = ["Documentation", "Products", "Blog", "About", "Core Pages"];

const SUFFIX_SEPARATORS = [" | ", " — ", " – ", " - "];

/**
 * Strip a common site-suffix from a page title: "Welcome | Acme" -> "Welcome".
 * Used on the homepage title to recover the site name.
 * @param title Page title to normalize.
 * @returns Title without a recognized brand suffix.
 */
export function stripTitleSuffix(title: string): string {
  const trimmed = title.trim();
  for (const separator of SUFFIX_SEPARATORS) {
    const idx = trimmed.indexOf(separator);
    if (idx > 0) return trimmed.slice(0, idx).trim();
  }
  return trimmed;
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function pathDepth(url: string): number {
  return pathOf(url)
    .split("/")
    .filter((seg) => seg.length > 0).length;
}

function isHomepage(url: string, origin: string): boolean {
  const path = pathOf(url);
  return (path === "/" || path === "") && url.startsWith(origin);
}

/**
 * Resolve the site name from the homepage title, falling back to the domain.
 * @param rows Crawled page rows for the site.
 * @param origin Site origin used to identify the homepage.
 * @returns Best-effort display name for the site.
 */
export function resolveSiteName(rows: PageRow[], origin: string): string {
  const home = rows.find((r) => isHomepage(r.url, origin));
  const raw = home?.title ?? home?.h1;
  if (raw && raw.trim().length > 0) return stripTitleSuffix(raw);
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

function richness(row: PageRow): number {
  let score = 0;
  if (row.title?.trim()) score += 2;
  if (row.description?.trim()) score += 2;
  else if (row.snippet?.trim()) score += 1;
  return score;
}

/**
 * Rank pages within a section: shallower paths first, then richer metadata
 * (title + description beats bare URLs), then URL for determinism.
 * @param rows Pages to rank.
 * @returns Ranked copy of the input rows.
 */
export function rankPages(rows: PageRow[]): PageRow[] {
  return [...rows].sort((a, b) => {
    const depth = pathDepth(a.url) - pathDepth(b.url);
    if (depth !== 0) return depth;
    const rich = richness(b) - richness(a);
    if (rich !== 0) return rich;
    return a.url < b.url ? -1 : a.url > b.url ? 1 : 0;
  });
}

function trimmedOrNull(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed;
}

function toInventoryPage(row: PageRow, section: string): InventoryPage {
  const description = trimmedOrNull(row.description) ?? trimmedOrNull(row.snippet);
  return {
    url: row.url,
    title: trimmedOrNull(row.title),
    description,
    h1: trimmedOrNull(row.h1),
    sectionHint: trimmedOrNull(row.sectionHint) ?? section,
  };
}

function sectionSortRank(name: string): number {
  const index = SECTION_ORDER.indexOf(name);
  return index === -1 ? Number.POSITIVE_INFINITY : index;
}

function compareSectionNames(a: string, b: string): number {
  const rank = sectionSortRank(a) - sectionSortRank(b);
  return rank === 0 ? a.localeCompare(b) : rank;
}

function splitRowsBySection(
  rows: PageRow[],
  origin: string,
): { bySection: Map<string, PageRow[]>; optionalRows: PageRow[] } {
  const bySection = new Map<string, PageRow[]>();
  const optionalRows: PageRow[] = [];

  for (const row of rows) {
    if (isHomepage(row.url, origin)) continue;
    const { section, optional } = classify(pathOf(row.url));
    if (optional) {
      optionalRows.push(row);
      continue;
    }
    bySection.set(section, [...(bySection.get(section) ?? []), row]);
  }

  return { bySection, optionalRows };
}

function buildSections(
  bySection: Map<string, PageRow[]>,
  optionalRows: PageRow[],
): SectionInventory[] {
  const sections: SectionInventory[] = [];
  const names = [...bySection.keys()].sort(compareSectionNames);

  for (const name of names) {
    const ranked = rankPages(bySection.get(name) ?? []);
    const kept = ranked.slice(0, MAX_LINKS_PER_SECTION);
    optionalRows.push(...ranked.slice(MAX_LINKS_PER_SECTION));
    sections.push({ name, pages: kept.map((row) => toInventoryPage(row, name)) });
  }

  return sections;
}

/**
 * Pass 1: build a deterministic Inventory from D1 page rows. The homepage is
 * represented by the H1 + blockquote, not as a link; everything else is
 * grouped by classify(), ranked, and capped — overflow demotes to Optional.
 * @param rows Crawled page rows to convert.
 * @param origin Site origin used for homepage detection.
 * @returns Deterministic inventory suitable for rendering.
 */
export function buildInventory(rows: PageRow[], origin: string): Inventory {
  const siteName = resolveSiteName(rows, origin);
  const home = rows.find((r) => isHomepage(r.url, origin));
  const homepageSnippet =
    trimmedOrNull(home?.description ?? null) ?? trimmedOrNull(home?.snippet ?? null);
  const { bySection, optionalRows } = splitRowsBySection(rows, origin);
  const sections = buildSections(bySection, optionalRows);

  return {
    siteName,
    origin,
    homepageSnippet,
    sections,
    optional: rankPages(optionalRows).map((r) => toInventoryPage(r, "Optional")),
  };
}
