import {
  DEFAULT_PAGE_CHECK_INTERVAL_S,
  nextPageInterval,
  nextPageStreak,
} from "../monitor/schedule";

export interface StoredPage {
  id: string;
  etag: string | null;
  lastModified: string | null;
  contentHash: string | null;
  outLinksJson: string | null;
  lastChangedAt: number | null;
  pageCheckIntervalS: number;
  pageChangeStreak: number;
}

export interface PageFreshness {
  lastCheckedAt: number;
  lastChangedAt?: number;
  pageCheckIntervalS: number;
  pageChangeStreak: number;
}

/**
 * Parse cached extracted links for frontier replay after a 304 response.
 *
 * @param existing Stored page row, if any.
 * @returns Cached links, or null when missing/unreadable.
 */
export function cachedLinks(existing: StoredPage | undefined): string[] | null {
  if (!existing?.outLinksJson) return null;
  try {
    const parsed = JSON.parse(existing.outLinksJson) as unknown;
    if (Array.isArray(parsed) && parsed.every((link) => typeof link === "string")) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Freshness fields for an unchanged page revalidation.
 *
 * @param existing Stored page row, if any.
 * @param now Current epoch second.
 * @returns Persistable page freshness fields.
 */
export function unchangedFreshness(existing: StoredPage | undefined, now: number): PageFreshness {
  return {
    lastCheckedAt: now,
    pageCheckIntervalS: nextPageInterval(
      existing?.pageCheckIntervalS ?? DEFAULT_PAGE_CHECK_INTERVAL_S,
      false,
      existing?.pageChangeStreak ?? 0,
    ),
    pageChangeStreak: nextPageStreak(existing?.pageChangeStreak ?? 0, false),
  };
}

/**
 * Freshness fields for a fetched HTML page.
 *
 * @param existing Stored page row, if any.
 * @param contentHash Hash extracted from the latest response.
 * @param now Current epoch second.
 * @returns Persistable page freshness fields.
 */
export function fetchedFreshness(
  existing: StoredPage | undefined,
  contentHash: string,
  now: number,
): Required<PageFreshness> {
  const changed = existing?.contentHash !== contentHash;
  const previousInterval = existing?.pageCheckIntervalS ?? DEFAULT_PAGE_CHECK_INTERVAL_S;
  const previousStreak = existing?.pageChangeStreak ?? 0;
  return {
    lastCheckedAt: now,
    lastChangedAt: changed ? now : (existing.lastChangedAt ?? now),
    pageCheckIntervalS: nextPageInterval(previousInterval, changed, previousStreak),
    pageChangeStreak: nextPageStreak(previousStreak, changed),
  };
}
