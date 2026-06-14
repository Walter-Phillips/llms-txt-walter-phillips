export type ExtractedPage = {
  title: string | null;
  description: string | null;
  h1: string | null;
  snippet: string | null;
  contentHash: string;
  /** raw href values found in <a> tags (unresolved, unfiltered) */
  links: string[];
};

const MIN_SNIPPET_CHARS = 40;
const MAX_LINKS = 300;

class TextCapture {
  value = "";
  done = false;
  text(t: { text: string; lastInTextNode: boolean }): void {
    if (this.done) return;
    this.value += t.text;
  }
}

/**
 * Streaming extraction via HTMLRewriter (Workers-native; no DOM parse cost).
 * The content hash covers meaningful text only — title + description + h1 +
 * snippet — so boilerplate/nav/CSRF churn doesn't trigger false changes.
 */
export async function extract(body: ReadableStream<Uint8Array>): Promise<ExtractedPage> {
  const title = new TextCapture();
  const h1 = new TextCapture();
  let description: string | null = null;
  let ogTitle: string | null = null;
  let ogDescription: string | null = null;
  const links: string[] = [];

  // Snippet: first <p> whose accumulated text is substantive.
  let snippet: string | null = null;
  let currentP = "";
  let inP = false;

  const rewriter = new HTMLRewriter()
    .on("title", {
      text(t) {
        title.text(t);
        if (t.lastInTextNode) title.done = true;
      }
    })
    .on("h1", {
      text(t) {
        h1.text(t);
        if (t.lastInTextNode) h1.done = true;
      }
    })
    .on("meta", {
      element(el) {
        const name = el.getAttribute("name")?.toLowerCase();
        const property = el.getAttribute("property")?.toLowerCase();
        const content = el.getAttribute("content");
        if (!content) return;
        if (name === "description" && description === null) description = content;
        else if (property === "og:title" && ogTitle === null) ogTitle = content;
        else if (property === "og:description" && ogDescription === null) ogDescription = content;
      }
    })
    .on("a", {
      element(el) {
        if (links.length >= MAX_LINKS) return;
        const href = el.getAttribute("href");
        if (href) links.push(href);
      }
    })
    .on("p", {
      element(el) {
        if (snippet !== null) return;
        inP = true;
        currentP = "";
        el.onEndTag(() => {
          inP = false;
          const text = currentP.replace(/\s+/g, " ").trim();
          if (snippet === null && text.length >= MIN_SNIPPET_CHARS) {
            snippet = text.slice(0, 400);
          }
        });
      },
      text(t) {
        if (inP && snippet === null) currentP += t.text;
      }
    });

  // Drive the stream through the rewriter to completion.
  await rewriter.transform(new Response(body)).arrayBuffer();

  const cleanTitle = title.value.replace(/\s+/g, " ").trim() || ogTitle || null;
  const cleanH1 = h1.value.replace(/\s+/g, " ").trim() || null;
  const cleanDescription = description ?? ogDescription;

  const contentHash = await sha256(
    [cleanTitle ?? "", cleanDescription ?? "", cleanH1 ?? "", snippet ?? ""].join("\n")
  );

  return {
    title: cleanTitle,
    description: cleanDescription,
    h1: cleanH1,
    snippet,
    contentHash,
    links
  };
}

export async function sha256(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
