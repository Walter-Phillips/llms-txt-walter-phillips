const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_|ref$|ref_|_ga$|session)/i;

/**
 * Normalize input → canonical origin string, or null if invalid / unsafe.
 * SSRF guard rejects localhost, private IPs, and non-http(s) schemes.
 */
export function normalizeOrigin(input: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    /^169\.254\./.test(host)
  ) {
    return null;
  }
  return `${parsed.protocol}//${host}`;
}

export function normalizeUrl(input: string, base?: string): string | null {
  let parsed: URL;
  try {
    parsed = base ? new URL(input, base) : new URL(input);
  } catch {
    return null;
  }
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase();
  const next = new URLSearchParams();
  for (const [k, v] of parsed.searchParams) {
    if (!TRACKING_PARAMS.test(k)) next.append(k, v);
  }
  parsed.search = next.toString();
  // Trailing-slash canonicalization: keep root "/", strip others.
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }
  return parsed.toString();
}
