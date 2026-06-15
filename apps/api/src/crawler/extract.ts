export interface ExtractedPage {
  title: string | null;
  description: string | null;
  h1: string | null;
  snippet: string | null;
  contentHash: string;
  /** raw href values found in <a> tags (unresolved, unfiltered) */
  links: string[];
}

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

interface ExtractionState {
  title: TextCapture;
  h1: TextCapture;
  description: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  links: string[];
  snippet: string | null;
  currentParagraph: string;
  inParagraph: boolean;
}

/**
 * Streaming extraction via HTMLRewriter (Workers-native; no DOM parse cost).
 * The content hash covers meaningful text only — title + description + h1 +
 * snippet — so boilerplate/nav/CSRF churn doesn't trigger false changes.
 *
 * @param body - HTML response body to stream through the rewriter.
 * @returns Extracted metadata, links, snippet, and content hash.
 */
export async function extract(body: ReadableStream<Uint8Array>): Promise<ExtractedPage> {
  const state = createExtractionState();
  const rewriter = createRewriter(state);

  // Drive the stream through the rewriter to completion.
  await rewriter.transform(new Response(body)).arrayBuffer();

  return buildExtractedPage(state);
}

function createExtractionState(): ExtractionState {
  return {
    title: new TextCapture(),
    h1: new TextCapture(),
    description: null,
    ogTitle: null,
    ogDescription: null,
    links: [],
    snippet: null,
    currentParagraph: "",
    inParagraph: false,
  };
}

function createRewriter(state: ExtractionState): HTMLRewriter {
  const rewriter = new HTMLRewriter()
    .on("title", {
      text(t) {
        state.title.text(t);
        if (t.lastInTextNode) state.title.done = true;
      },
    })
    .on("h1", {
      text(t) {
        state.h1.text(t);
        if (t.lastInTextNode) state.h1.done = true;
      },
    });

  return addParagraphExtraction(
    addLinkExtraction(addMetaExtraction(rewriter, state), state),
    state,
  );
}

function addMetaExtraction(rewriter: HTMLRewriter, state: ExtractionState): HTMLRewriter {
  return rewriter.on("meta", {
    element(element) {
      const name = element.getAttribute("name")?.toLowerCase();
      const property = element.getAttribute("property")?.toLowerCase();
      const content = element.getAttribute("content");
      if (!content) return;
      if (name === "description" && state.description === null) state.description = content;
      else if (property === "og:title" && state.ogTitle === null) state.ogTitle = content;
      else if (property === "og:description" && state.ogDescription === null) {
        state.ogDescription = content;
      }
    },
  });
}

function addLinkExtraction(rewriter: HTMLRewriter, state: ExtractionState): HTMLRewriter {
  return rewriter.on("a", {
    element(element) {
      if (state.links.length >= MAX_LINKS) return;
      const href = element.getAttribute("href");
      if (href) state.links.push(href);
    },
  });
}

function addParagraphExtraction(rewriter: HTMLRewriter, state: ExtractionState): HTMLRewriter {
  return rewriter.on("p", {
    element(element) {
      if (state.snippet !== null) return;
      state.inParagraph = true;
      state.currentParagraph = "";
      element.onEndTag(() => {
        state.inParagraph = false;
        const text = state.currentParagraph.replace(/\s+/g, " ").trim();
        if (state.snippet === null && text.length >= MIN_SNIPPET_CHARS) {
          state.snippet = text.slice(0, 400);
        }
      });
    },
    text(t) {
      if (state.inParagraph && state.snippet === null) state.currentParagraph += t.text;
    },
  });
}

async function buildExtractedPage(state: ExtractionState): Promise<ExtractedPage> {
  const title = cleanText(state.title.value);
  const h1 = cleanText(state.h1.value);
  const cleanTitle = title === "" ? state.ogTitle : title;
  const cleanH1 = h1 === "" ? null : h1;
  const cleanDescription = state.description ?? state.ogDescription;

  const contentHash = await sha256(
    [cleanTitle ?? "", cleanDescription ?? "", cleanH1 ?? "", state.snippet ?? ""].join("\n"),
  );

  return {
    title: cleanTitle,
    description: cleanDescription,
    h1: cleanH1,
    snippet: state.snippet,
    contentHash,
    links: state.links,
  };
}

function cleanText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

/**
 * Compute a stable SHA-256 hex digest for extracted page content.
 *
 * @param input - Text to hash.
 * @returns Lowercase hexadecimal digest.
 */
async function sha256(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
