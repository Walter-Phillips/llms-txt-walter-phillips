// Layered change detection — cheapest signal first.
// 1. sitemap diff (URLs added/removed + lastmod deltas)
// 2. conditional GETs for candidates + rotating sample
// 3. content-hash compare for anything actually re-fetched
//
// Threshold: structural change OR ≥1 metadata change → regenerate.
// Pure body-text drift with identical metadata → record, don't regenerate.

export type ChangeSet = {
  added: string[];
  removed: string[];
  modified: string[];
};

export const EMPTY_CHANGESET: ChangeSet = { added: [], removed: [], modified: [] };

export function isRegenerationWorthy(c: ChangeSet): boolean {
  return c.added.length > 0 || c.removed.length > 0 || c.modified.length > 0;
}
