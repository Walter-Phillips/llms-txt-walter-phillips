import type { Inventory, InventoryPage, SectionInventory } from "@profound-takehome/shared";

export type { InventoryPage, SectionInventory, Inventory } from "@profound-takehome/shared";

/** Subset of a D1 `pages` row the heuristics need. Pure-data input. */
export type PageRow = {
  url: string;
  title: string | null;
  description: string | null;
  h1: string | null;
  snippet: string | null;
  sectionHint: string | null;
};

export const MAX_LINKS_PER_SECTION = 10;

const RULES: Array<{ rx: RegExp; section: string; optional?: boolean }> = [
  {
    rx: /^\/(docs|documentation|guide|guides|api|reference|developers?|sdk)/i,
    section: "Documentation"
  },
  { rx: /^\/(blog|news|articles|posts|changelog|releases)/i, section: "Blog" },
  { rx: /^\/\d{4}\/\d{2}\//, section: "Blog" },
  { rx: /^\/(pricing|plans|products?|features|solutions|integrations)/i, section: "Products" },
  { rx: /^\/(about|team|contact|company|customers|case-studies)/i, section: "About" },
  { rx: /^\/(support|help|faq)/i, section: "Documentation" },
  {
    rx: /^\/(legal|privacy|terms|cookies|careers|jobs|press|media)/i,
    section: "Optional",
    optional: true
  }
];

// Pass 1: deterministic classify. Pass 2 (LLM) renames/reorders sections.
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
 */
export function stripTitleSuffix(title: string): string {
  const trimmed = title.trim();
  for (const sep of SUFFIX_SEPARATORS) {
    const idx = trimmed.indexOf(sep);
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

/** Resolve the site name from the homepage title, falling back to the domain. */
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
  if (row.title && row.title.trim()) score += 2;
  if (row.description && row.description.trim()) score += 2;
  else if (row.snippet && row.snippet.trim()) score += 1;
  return score;
}

/**
 * Rank pages within a section: shallower paths first, then richer metadata
 * (title + description beats bare URLs), then URL for determinism.
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

function toInventoryPage(row: PageRow, section: string): InventoryPage {
  return {
    url: row.url,
    title: row.title?.trim() || null,
    description: row.description?.trim() || row.snippet?.trim() || null,
    h1: row.h1?.trim() || null,
    sectionHint: row.sectionHint?.trim() || section
  };
}

/**
 * Pass 1: build a deterministic Inventory from D1 page rows. The homepage is
 * represented by the H1 + blockquote, not as a link; everything else is
 * grouped by classify(), ranked, and capped — overflow demotes to Optional.
 */
export function buildInventory(rows: PageRow[], origin: string): Inventory {
  const siteName = resolveSiteName(rows, origin);
  const home = rows.find((r) => isHomepage(r.url, origin));
  const homepageSnippet = home?.description?.trim() || home?.snippet?.trim() || null;

  const bySection = new Map<string, PageRow[]>();
  const optionalRows: PageRow[] = [];

  for (const row of rows) {
    if (isHomepage(row.url, origin)) continue;
    const { section, optional } = classify(pathOf(row.url));
    if (optional) {
      optionalRows.push(row);
      continue;
    }
    const bucket = bySection.get(section) ?? [];
    bucket.push(row);
    bySection.set(section, bucket);
  }

  const names = [...bySection.keys()].sort((a, b) => {
    const ai = SECTION_ORDER.indexOf(a);
    const bi = SECTION_ORDER.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });

  const sections: SectionInventory[] = [];
  for (const name of names) {
    const ranked = rankPages(bySection.get(name)!);
    const kept = ranked.slice(0, MAX_LINKS_PER_SECTION);
    optionalRows.push(...ranked.slice(MAX_LINKS_PER_SECTION));
    sections.push({ name, pages: kept.map((r) => toInventoryPage(r, name)) });
  }

  return {
    siteName,
    origin,
    homepageSnippet,
    sections,
    optional: rankPages(optionalRows).map((r) => toInventoryPage(r, "Optional"))
  };
}
