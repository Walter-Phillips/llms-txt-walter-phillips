const UA = "llms-txt-generator/1.0 (+https://llms-txt.example.com/about)";

const TIMEOUT_MS = 10_000;
export const MAX_BODY_BYTES = 2 * 1024 * 1024;

export type FetchResult = {
  status: number;
  body: ReadableStream<Uint8Array> | null;
  etag: string | null;
  lastModified: string | null;
  contentType: string | null;
};

export async function politeFetch(
  url: string,
  opts: { etag?: string; lastModified?: string } = {},
): Promise<FetchResult> {
  const headers: Record<string, string> = { "user-agent": UA };
  if (opts.etag) headers["if-none-match"] = opts.etag;
  if (opts.lastModified) headers["if-modified-since"] = opts.lastModified;

  const res = await fetch(url, {
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const declaredLength = Number.parseInt(res.headers.get("content-length") ?? "", 10);
  let body = res.body;
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    await res.body?.cancel();
    body = null;
  }

  return {
    status: res.status,
    body,
    etag: res.headers.get("etag"),
    lastModified: res.headers.get("last-modified"),
    contentType: res.headers.get("content-type"),
  };
}

export function isHtml(contentType: string | null): boolean {
  if (!contentType) return false;
  return /text\/html|application\/xhtml/i.test(contentType);
}

/** Read a body stream as text, hard-capped at maxBytes (cancels the rest). */
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
