import { isBlockedHost } from "../lib/url";

const UA = "llms-txt-generator/1.0 (+https://llms-txt.example.com/about)";

const TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;

export interface FetchResult {
  status: number;
  body: ReadableStream<Uint8Array> | null;
  etag: string | null;
  lastModified: string | null;
  contentType: string | null;
  contentEncoding: string | null;
}

/**
 * Fetch a URL with crawler headers, redirect validation, and a body-size cap.
 *
 * @param url - URL to fetch.
 * @param options - Conditional request and body limit options.
 * @param options.etag - Previous ETag used for `If-None-Match`.
 * @param options.lastModified - Previous timestamp used for `If-Modified-Since`.
 * @param options.maxBodyBytes - Maximum allowed response body size in bytes.
 * @returns Fetch metadata and the readable body when it is safe to consume.
 */
export async function politeFetch(
  url: string,
  options: { etag?: string; lastModified?: string; maxBodyBytes?: number } = {},
): Promise<FetchResult> {
  let current = assertAllowedTarget(url);

  for (let hop = 0; ; hop++) {
    const res = await fetch(current.toString(), {
      headers: buildHeaders(options),
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!isRedirect(res.status)) {
      const body = await bodyWithinLimit(res, options.maxBodyBytes ?? MAX_BODY_BYTES);
      return {
        status: res.status,
        body,
        etag: res.headers.get("etag"),
        lastModified: res.headers.get("last-modified"),
        contentType: res.headers.get("content-type"),
        contentEncoding: res.headers.get("content-encoding"),
      };
    }

    const location = res.headers.get("location");
    await res.body?.cancel();
    if (!location || hop >= MAX_REDIRECTS) {
      throw new Error(`redirect limit or missing location at ${current.hostname}`);
    }
    current = assertAllowedTarget(new URL(location, current).toString());
  }
}

function buildHeaders(options: { etag?: string; lastModified?: string }): Record<string, string> {
  const headers: Record<string, string> = { "user-agent": UA };
  if (options.etag) headers["if-none-match"] = options.etag;
  if (options.lastModified) headers["if-modified-since"] = options.lastModified;
  return headers;
}

function assertAllowedTarget(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`invalid fetch url: ${rawUrl}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`blocked non-http scheme: ${parsed.protocol}`);
  }
  if (isBlockedHost(parsed.hostname)) {
    throw new Error(`blocked fetch to internal host: ${parsed.hostname}`);
  }
  return parsed;
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function bodyWithinLimit(
  response: Response,
  maxBodyBytes: number,
): Promise<ReadableStream<Uint8Array> | null> {
  const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (!Number.isFinite(declaredLength) || declaredLength <= maxBodyBytes) return response.body;

  await response.body?.cancel();
  return null;
}

/**
 * Determine whether a response content type can be parsed as HTML.
 *
 * @param contentType - Response `Content-Type` header value.
 * @returns Whether the content type is HTML-compatible.
 */
export function isHtml(contentType: string | null): boolean {
  if (!contentType) return false;
  return /text\/html|application\/xhtml/i.test(contentType);
}

/**
 * Read a body stream as text, hard-capped at maxBytes (cancels the rest).
 *
 * @param body - Response body stream to decode.
 * @param maxBytes - Maximum number of bytes to read before cancellation.
 * @returns Decoded text from the stream.
 */
export async function readBodyText(
  body: ReadableStream<Uint8Array>,
  maxBytes = MAX_BODY_BYTES,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (bytes >= maxBytes) {
      await reader.cancel();
      break;
    }
  }
  out += decoder.decode();
  return out;
}
