/**
 * Extracts the bare hostname from a site origin or domain for display.
 * @param originOrDomain Site origin (e.g. "https://acme.dev") or hostname.
 * @returns Hostname without scheme, or the input unchanged if it can't be parsed.
 */
export function hostnameOf(originOrDomain: string): string {
  try {
    return new URL(originOrDomain).hostname;
  } catch {
    return originOrDomain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
}
