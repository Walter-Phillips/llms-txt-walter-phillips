const UA = "llms-txt-generator/1.0 (+https://llms-txt.example.com/about)";

export type FetchResult = {
  status: number;
  body: ReadableStream<Uint8Array> | null;
  etag: string | null;
  lastModified: string | null;
  contentType: string | null;
};

// TODO: 10s timeout, conditional GET headers (If-None-Match / If-Modified-Since),
// non-HTML skip, 2MB size cap, exponential backoff on 429/503.
export async function politeFetch(
  url: string,
  opts: { etag?: string; lastModified?: string } = {},
): Promise<FetchResult> {
  const headers: HeadersInit = { "user-agent": UA };
  if (opts.etag) (headers as Record<string, string>)["if-none-match"] = opts.etag;
  if (opts.lastModified) (headers as Record<string, string>)["if-modified-since"] = opts.lastModified;

  const res = await fetch(url, { headers, redirect: "follow" });
  return {
    status: res.status,
    body: res.body,
    etag: res.headers.get("etag"),
    lastModified: res.headers.get("last-modified"),
    contentType: res.headers.get("content-type"),
  };
}
