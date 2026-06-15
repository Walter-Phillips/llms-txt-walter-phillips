/**
 * Canonical, absolute origin for the deployed site. Drives metadataBase,
 * sitemap/robots URLs, and structured data. Set NEXT_PUBLIC_SITE_URL to the
 * production origin in deployment; falls back to localhost for local dev.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
).replace(/\/$/, "");

export const SITE_NAME = "llms.txt generator";

export const SITE_DESCRIPTION =
  "Paste a URL, get a spec-compliant llms.txt: a plain-text map of your site for language models. Hosted, versioned, and kept up to date.";

/**
 * Build an absolute URL from a site-root-relative path.
 *
 * @param path Root-relative path (with or without a leading slash).
 * @returns The fully-qualified URL on the canonical site origin.
 */
export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
