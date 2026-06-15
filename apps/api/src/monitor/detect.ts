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

/**
 * Decide whether a detected change set should trigger regeneration.
 * @param c Change set assembled by the monitor pipeline.
 * @returns True when at least one URL was added, removed, or modified.
 */
export function isRegenerationWorthy(c: ChangeSet): boolean {
  return c.added.length > 0 || c.removed.length > 0 || c.modified.length > 0;
}

// ---------------------------------------------------------------------------
// Layer 1: sitemap diff
// ---------------------------------------------------------------------------

export interface StoredPageMeta {
  url: string;
  sitemapLastmod: string | null;
}
export interface SitemapEntry {
  url: string;
  lastmod: string | null;
}

export interface SitemapDiff {
  added: string[];
  removed: string[];
  /** URLs present in both but whose sitemap <lastmod> moved. */
  lastmodChanged: string[];
}

/**
 * Compare stored sitemap metadata with the latest sitemap entries.
 * @param stored Previously crawled URL metadata.
 * @param current Current sitemap entries.
 * @returns Added, removed, and lastmod-changed URL buckets.
 */
export function diffSitemap(stored: StoredPageMeta[], current: SitemapEntry[]): SitemapDiff {
  const storedByUrl = new Map(stored.map((p) => [p.url, p]));
  const currentByUrl = new Map(current.map((entry) => [entry.url, entry]));

  const added: string[] = [];
  const lastmodChanged: string[] = [];
  for (const entry of current) {
    const previous = storedByUrl.get(entry.url);
    if (!previous) {
      added.push(entry.url);
    } else if (
      entry.lastmod &&
      previous.sitemapLastmod &&
      entry.lastmod !== previous.sitemapLastmod
    ) {
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

export interface ConditionalResponse {
  status: number;
  etag: string | null;
  lastModified: string | null;
}

export interface StoredValidators {
  etag: string | null;
  lastModified: string | null;
}

function statusOutcome(status: number): ConditionalOutcome | null {
  if (status === 304) return "unchanged";
  if (status === 404 || status === 410) return "removed";
  if (status !== 200) return "error";
  return null;
}

function validatorsMatch(res: ConditionalResponse, stored: StoredValidators): boolean {
  if (stored.etag && res.etag && res.etag === stored.etag) return true;
  return !stored.etag && Boolean(stored.lastModified) && res.lastModified === stored.lastModified;
}

/**
 * Classify a conditional-GET response against the validators we stored when
 * the page was last crawled. 304 is authoritative "unchanged"; a 200 is only
 * a *candidate* — servers that ignore validators return 200 for everything,
 * so we cross-check the returned validators before declaring "modified".
 * @param res HTTP response metadata from the conditional fetch.
 * @param stored Validators saved from the last crawl.
 * @returns Change outcome implied by HTTP status and validators.
 */
export function classifyConditionalGet(
  res: ConditionalResponse,
  stored: StoredValidators,
): ConditionalOutcome {
  const outcome = statusOutcome(res.status);
  if (outcome !== null) return outcome;

  // 200 with a validator that matches what we stored → server ignored the
  // conditional headers but nothing actually changed.
  if (validatorsMatch(res, stored)) return "unchanged";

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

/**
 * Compare two known content hashes.
 * @param storedHash Hash recorded during the prior crawl.
 * @param currentHash Hash from the latest fetch.
 * @returns True only when both hashes are known and differ.
 */
export function hashChanged(storedHash: string | null, currentHash: string | null): boolean {
  // Unknown hashes never count as a change — we only assert what we can prove.
  if (storedHash === null || currentHash === null) return false;
  return storedHash !== currentHash;
}

// ---------------------------------------------------------------------------
// Assembly: fold all layers into one ChangeSet
// ---------------------------------------------------------------------------

export interface DetectionInputs {
  sitemap?: SitemapDiff;
  conditional?: { url: string; outcome: ConditionalOutcome }[];
  hashes?: { url: string; storedHash: string | null; currentHash: string | null }[];
}

function addConditionalOutcomes(
  conditional: DetectionInputs["conditional"],
  removed: Set<string>,
  modified: Set<string>,
): void {
  for (const { url, outcome } of conditional ?? []) {
    if (outcome === "removed") removed.add(url);
    else if (outcome === "modified") modified.add(url);
  }
}

function addHashOutcomes(hashes: DetectionInputs["hashes"], modified: Set<string>): void {
  for (const hash of hashes ?? []) {
    if (hashChanged(hash.storedHash, hash.currentHash)) modified.add(hash.url);
  }
}

function applyBucketPrecedence(
  added: Set<string>,
  removed: Set<string>,
  modified: Set<string>,
): void {
  for (const url of added) {
    removed.delete(url);
    modified.delete(url);
  }
  for (const url of removed) modified.delete(url);
}

/**
 * Build a ChangeSet from pre-computed layer results. Dedupe rules:
 * - a URL is reported in at most one bucket; added > removed > modified.
 * - "error" conditional outcomes are dropped — transient failures must not
 *   trigger regeneration or page removal.
 * @param inputs Layer results to merge.
 * @returns Deduped change set with sorted URL buckets.
 */
export function buildChangeSet(inputs: DetectionInputs): ChangeSet {
  const added = new Set<string>(inputs.sitemap?.added ?? []);
  const removed = new Set<string>(inputs.sitemap?.removed ?? []);
  const modified = new Set<string>();

  addConditionalOutcomes(inputs.conditional, removed, modified);
  addHashOutcomes(inputs.hashes, modified);
  applyBucketPrecedence(added, removed, modified);

  return {
    added: [...added].sort(),
    removed: [...removed].sort(),
    modified: [...modified].sort(),
  };
}
