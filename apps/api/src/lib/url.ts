const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_|ref$|ref_|_ga$|session)/i;

/**
 * Normalize input → canonical origin string, or null if invalid / unsafe.
 * SSRF guard rejects localhost, private IPs, and non-http(s) schemes.
 *
 * @param input - User-supplied site URL.
 * @returns Canonical origin string when the input is safe; otherwise null.
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

/**
 * True if a hostname points at loopback/private/link-local space.
 *
 * @param hostname - Hostname to classify.
 * @returns Whether the host should be blocked from server-side fetches.
 */
export function isBlockedHost(hostname: string): boolean {
  const host = stripIpv6Brackets(hostname.toLowerCase());
  const mappedIpv4 = ipv4FromMappedIpv6(host);

  return (
    isLocalhostName(host) ||
    isBlockedIpv6Host(host) ||
    (mappedIpv4 === null
      ? isBlockedIpv4Host(toDottedQuad(host) ?? host)
      : isBlockedHost(mappedIpv4))
  );
}

function stripIpv6Brackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function isLocalhostName(host: string): boolean {
  return host === "localhost" || host.endsWith(".localhost");
}

function isBlockedIpv6Host(host: string): boolean {
  return (
    host === "::1" ||
    host === "::" ||
    /^fe[89ab][0-9a-f]:/.test(host) ||
    /^f[cd][0-9a-f]{2}:/.test(host)
  );
}

function ipv4FromMappedIpv6(host: string): string | null {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
  if (mapped) return mapped[1];

  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (!mappedHex) return null;

  const high = Number.parseInt(mappedHex[1], 16);
  const low = Number.parseInt(mappedHex[2], 16);
  return [(high >>> 8) & 255, high & 255, (low >>> 8) & 255, low & 255].join(".");
}

const BLOCKED_IPV4_PATTERNS = [
  /^0\./,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^169\.254\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

function isBlockedIpv4Host(ipv4: string): boolean {
  return ipv4 === "0.0.0.0" || BLOCKED_IPV4_PATTERNS.some((pattern) => pattern.test(ipv4));
}

function toDottedQuad(host: string): string | null {
  let value: number;
  if (/^\d+$/.test(host)) {
    value =
      host.length > 1 && host.startsWith("0")
        ? Number.parseInt(host, 8)
        : Number.parseInt(host, 10);
  } else if (/^0x[0-9a-f]+$/i.test(host)) {
    value = Number.parseInt(host.slice(2), 16);
  } else {
    return null;
  }

  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) return null;
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
}

/**
 * Normalize a URL for crawl de-duplication.
 *
 * @param input - Absolute or relative URL to normalize.
 * @param base - Base URL used to resolve relative input.
 * @returns Canonical URL string, or null when parsing fails.
 */
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
 *
 * @param url - URL whose path should be measured.
 * @returns Path depth, or a large sentinel for invalid URLs.
 */
export function urlPathDepth(url: string): number {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}
