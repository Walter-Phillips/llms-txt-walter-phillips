export type ExtractedPage = {
  title: string | null;
  description: string | null;
  ogSiteName: string | null;
  canonical: string | null;
  h1: string | null;
  snippet: string | null;
  contentHash: string;
};

// TODO: HTMLRewriter streaming pipeline — collect <title>, meta[name=description],
// og:title/description/site_name, link[rel=canonical], first <h1>, first
// substantive <p>. Hash over (title + description + h1 + snippet), NOT raw HTML.
export async function extract(_body: ReadableStream<Uint8Array>): Promise<ExtractedPage> {
  return {
    title: null,
    description: null,
    ogSiteName: null,
    canonical: null,
    h1: null,
    snippet: null,
    contentHash: "",
  };
}

export async function sha256(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
