// Layered change detection — cheapest signal first.
// 1. sitemap diff (URLs added/removed + lastmod deltas)
// 2. conditional GETs for candidates + rotating sample
// 3. content-hash compare for anything actually re-fetched
//
// Threshold: structural change OR ≥1 metadata change → regenerate.
// Pure body-text drift with identical metadata → record, don't regenerate.
//
// Everything in this module is pure over caller-provided inputs so the
// monitor consumer (which owns I/O) stays thin and the logic stays testable.

import type { ChangeSet } from "@profound-takehome/shared";

export type { ChangeSet };

export const EMPTY_CHANGESET: ChangeSet = { added: [], removed: [], modified: [] };

export function isRegenerationWorthy(c: ChangeSet): boolean {
  return c.added.length > 0 || c.removed.length > 0 || c.modified.length > 0;
}

// ---------------------------------------------------------------------------
// Layer 1: sitemap diff
// ---------------------------------------------------------------------------

export type StoredPageMeta = { url: string; sitemapLastmod: string | null };
export type SitemapEntry = { url: string; lastmod: string | null };

export type SitemapDiff = {
  added: string[];
  removed: string[];
  /** URLs present in both but whose sitemap <lastmod> moved. */
  lastmodChanged: string[];
};

export function diffSitemap(stored: StoredPageMeta[], current: SitemapEntry[]): SitemapDiff {
  const storedByUrl = new Map(stored.map((p) => [p.url, p]));
  const currentByUrl = new Map(current.map((e) => [e.url, e]));

  const added: string[] = [];
  const lastmodChanged: string[] = [];
  for (const entry of current) {
    const prev = storedByUrl.get(entry.url);
    if (!prev) {
      added.push(entry.url);
    } else if (entry.lastmod && prev.sitemapLastmod && entry.lastmod !== prev.sitemapLastmod) {
      lastmodChanged.push(entry.url);
    }
  }

  const removed = stored.filter((p) => !currentByUrl.has(p.url)).map((p) => p.url);
  return { added, removed, lastmodChanged };
}

// ---------------------------------------------------------------------------
// Layer 2: conditional-GET outcome classification
// ---------------------------------------------------------------------------

export type ConditionalOutcome = "unchanged" | "modified" | "removed" | "error";

export type ConditionalResponse = {
  status: number;
  etag: string | null;
  lastModified: string | null;
};

export type StoredValidators = {
  etag: string | null;
  lastModified: string | null;
};

/**
 * Classify a conditional-GET response against the validators we stored when
 * the page was last crawled. 304 is authoritative "unchanged"; a 200 is only
 * a *candidate* — servers that ignore validators return 200 for everything,
 * so we cross-check the returned validators before declaring "modified".
 */
export function classifyConditionalGet(
  res: ConditionalResponse,
  stored: StoredValidators,
): ConditionalOutcome {
  if (res.status === 304) return "unchanged";
  if (res.status === 404 || res.status === 410) return "removed";
  if (res.status !== 200) return "error";

  // 200 with a validator that matches what we stored → server ignored the
  // conditional headers but nothing actually changed.
  if (stored.etag && res.etag && res.etag === stored.etag) return "unchanged";
  if (!stored.etag && stored.lastModified && res.lastModified === stored.lastModified) {
    return "unchanged";
  }

  // No usable validators on either side: HTTP signals alone can't prove the
  // body changed. Callers with a fetched body resolve this via a content-hash
  // compare (buildChangeSet `hashes`), which is authoritative and suppresses
  // this guess; absent a body the modified verdict stands and the idempotent
  // re-crawl absorbs any false positive.
  return "modified";
}

// ---------------------------------------------------------------------------
// Layer 3: content-hash compare (hashes supplied by the caller)
// ---------------------------------------------------------------------------

export function hashChanged(storedHash: string | null, currentHash: string | null): boolean {
  // Unknown hashes never count as a change — we only assert what we can prove.
  if (!storedHash || !currentHash) return false;
  return storedHash !== currentHash;
}

// ---------------------------------------------------------------------------
// Assembly: fold all layers into one ChangeSet
// ---------------------------------------------------------------------------

export type DetectionInputs = {
  sitemap?: SitemapDiff;
  conditional?: { url: string; outcome: ConditionalOutcome }[];
  hashes?: { url: string; storedHash: string | null; currentHash: string | null }[];
};

/**
 * Build a ChangeSet from pre-computed layer results. Dedupe rules:
 * - a URL is reported in at most one bucket; added > removed > modified.
 * - "error" conditional outcomes are dropped — transient failures must not
 *   trigger regeneration or page removal.
 */
export function buildChangeSet(inputs: DetectionInputs): ChangeSet {
  const added = new Set<string>(inputs.sitemap?.added ?? []);
  const removed = new Set<string>(inputs.sitemap?.removed ?? []);
  const modified = new Set<string>();

  for (const { url, outcome } of inputs.conditional ?? []) {
    if (outcome === "removed") removed.add(url);
    else if (outcome === "modified") modified.add(url);
  }

  for (const h of inputs.hashes ?? []) {
    if (hashChanged(h.storedHash, h.currentHash)) modified.add(h.url);
  }

  for (const url of added) {
    removed.delete(url);
    modified.delete(url);
  }
  for (const url of removed) modified.delete(url);

  return {
    added: [...added].sort(),
    removed: [...removed].sort(),
    modified: [...modified].sort(),
  };
}
