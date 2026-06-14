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
  if (isBlockedHost(host)) return null;
  return `${parsed.protocol}//${host}`;
}

/** True if a hostname points at loopback/private/link-local space. */
export function isBlockedHost(hostname: string): boolean {
  let host = hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);

  if (host === "localhost" || host.endsWith(".localhost")) return true;

  if (host === "::1" || host === "::") return true;
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true;
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;

  const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedHost(mapped[1]!);
  const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = Number.parseInt(mappedHex[1]!, 16);
    const lo = Number.parseInt(mappedHex[2]!, 16);
    return isBlockedHost(`${(hi >>> 8) & 255}.${hi & 255}.${(lo >>> 8) & 255}.${lo & 255}`);
  }

  const dotted = toDottedQuad(host);
  const ipv4 = dotted ?? host;
  if (
    ipv4 === "0.0.0.0" ||
    /^0\./.test(ipv4) ||
    /^127\./.test(ipv4) ||
    /^10\./.test(ipv4) ||
    /^192\.168\./.test(ipv4) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ipv4) ||
    /^169\.254\./.test(ipv4) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ipv4)
  ) {
    return true;
  }
  return false;
}

function toDottedQuad(host: string): string | null {
  let value: number;
  if (/^\d+$/.test(host)) {
    value = host.length > 1 && host.startsWith("0") ? Number.parseInt(host, 8) : Number.parseInt(host, 10);
  } else if (/^0x[0-9a-f]+$/i.test(host)) {
    value = Number.parseInt(host.slice(2), 16);
  } else {
    return null;
  }

  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) return null;
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
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

/**
 * Number of non-empty path segments in a URL. Unparseable URLs sort last.
 */
export function urlPathDepth(url: string): number {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}
