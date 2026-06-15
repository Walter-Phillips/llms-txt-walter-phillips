import { beforeAll, describe, expect, it, vi } from "vitest";
import { buildInventory, classify, type PageRow } from "../generator/heuristics";
import { render } from "../generator/render";
import { validate } from "../generator/validate";
import { extract, type ExtractedPage } from "./extract";
import { isHtml, politeFetch } from "./fetcher";
import { acceptUrls } from "./frontier";

const BOOKS_ORIGIN = "https://books.toscrape.com";
const QUOTES_ORIGIN = "https://quotes.toscrape.com";
const LIVE_TIMEOUT_MS = 45_000;

interface ElementHandler {
  element?: (element: TestElement) => void;
  text?: (text: { text: string; lastInTextNode: boolean }) => void;
}

class TestElement {
  private endTag: (() => void) | null = null;

  constructor(private readonly attributes: Map<string, string>) {}

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  onEndTag(callback: () => void): void {
    this.endTag = callback;
  }

  close(): void {
    this.endTag?.();
  }
}

class TestHtmlRewriter {
  private readonly handlers = new Map<string, ElementHandler[]>();

  on(selector: string, handler: ElementHandler): this {
    this.handlers.set(selector, [...(this.handlers.get(selector) ?? []), handler]);
    return this;
  }

  transform(response: Response): Response {
    return {
      arrayBuffer: async () => {
        const html = await response.text();
        this.rewriteTextElement(html, "title");
        this.rewriteTextElement(html, "h1");
        this.rewriteMetaElements(html);
        this.rewriteAnchorElements(html);
        this.rewriteParagraphElements(html);
        return new ArrayBuffer(0);
      },
    } as Response;
  }

  private rewriteTextElement(html: string, selector: "title" | "h1"): void {
    const match = new RegExp(`<${selector}[^>]*>([\\s\\S]*?)</${selector}>`, "i").exec(html);
    if (!match) return;
    for (const handler of this.handlers.get(selector) ?? []) {
      handler.text?.({ text: stripTags(match[1]), lastInTextNode: true });
    }
  }

  private rewriteMetaElements(html: string): void {
    for (const match of html.matchAll(/<meta\s+([^>]+)>/gi)) {
      this.emitElement("meta", attributesFromSource(match[1]));
    }
  }

  private rewriteAnchorElements(html: string): void {
    for (const match of html.matchAll(/<a\s+([^>]+)>/gi)) {
      this.emitElement("a", attributesFromSource(match[1]));
    }
  }

  private rewriteParagraphElements(html: string): void {
    for (const match of html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
      const element = this.emitElement("p", new Map());
      for (const handler of this.handlers.get("p") ?? []) {
        handler.text?.({ text: stripTags(match[1]), lastInTextNode: true });
      }
      element.close();
    }
  }

  private emitElement(selector: string, attributes: Map<string, string>): TestElement {
    const element = new TestElement(attributes);
    for (const handler of this.handlers.get(selector) ?? []) {
      handler.element?.(element);
    }
    return element;
  }
}

function stripTags(input: string): string {
  return input
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function attributesFromSource(source: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of source.matchAll(/([\w:-]+)=["']([^"']*)["']/g)) {
    attributes.set(match[1].toLowerCase(), match[2]);
  }
  return attributes;
}

async function fetchExtracted(url: string): Promise<ExtractedPage> {
  const response = await politeFetch(url);
  expect(response.status).toBe(200);
  expect(isHtml(response.contentType)).toBe(true);
  if (!response.body) throw new Error(`missing response body for ${url}`);
  return await extract(response.body);
}

function acceptedLinks(url: string, page: ExtractedPage): string[] {
  const origin = new URL(url).origin;
  return acceptUrls({
    candidates: page.links,
    baseUrl: url,
    origin,
    seen: new Set(),
    disallow: [],
    pageBudget: 100,
  });
}

async function liveRow(url: string): Promise<PageRow> {
  const page = await fetchExtracted(url);
  return {
    url,
    title: page.title,
    description: page.description,
    h1: page.h1,
    snippet: page.snippet,
    sectionHint: classify(new URL(url).pathname).section,
  };
}

beforeAll(() => {
  vi.stubGlobal("HTMLRewriter", TestHtmlRewriter);
});

describe("toscrape live crawler probe", () => {
  it(
    "extracts and normalizes representative Books links",
    async () => {
      const page = await fetchExtracted(`${BOOKS_ORIGIN}/`);
      const accepted = acceptedLinks(`${BOOKS_ORIGIN}/`, page);

      expect(page.title).toContain("Books to Scrape");
      expect(page.h1).toBe("All products");
      expect(accepted).toContain(`${BOOKS_ORIGIN}/catalogue/page-2.html`);
      expect(accepted).toContain(`${BOOKS_ORIGIN}/catalogue/a-light-in-the-attic_1000/index.html`);
      expect(accepted.some((url) => /\.(?:jpg|png|css|js)$/i.test(url))).toBe(false);
    },
    LIVE_TIMEOUT_MS,
  );

  it(
    "extracts and normalizes representative Quotes links",
    async () => {
      const page = await fetchExtracted(`${QUOTES_ORIGIN}/`);
      const accepted = acceptedLinks(`${QUOTES_ORIGIN}/`, page);

      expect(page.title).toBe("Quotes to Scrape");
      expect(page.h1).toBe("Quotes to Scrape");
      expect(page.links).toContain("/login");
      expect(accepted).toContain(`${QUOTES_ORIGIN}/page/2`);
      expect(accepted).toContain(`${QUOTES_ORIGIN}/author/Albert-Einstein`);
      expect(accepted).not.toContain(`${QUOTES_ORIGIN}/login`);
    },
    LIVE_TIMEOUT_MS,
  );

  it(
    "keeps non-card Quotes variants crawlable without submitting forms",
    async () => {
      const urls = [
        `${QUOTES_ORIGIN}/tableful/`,
        `${QUOTES_ORIGIN}/login`,
        `${QUOTES_ORIGIN}/search.aspx`,
        `${QUOTES_ORIGIN}/random`,
      ];

      for (const url of urls) {
        const page = await fetchExtracted(url);
        expect(page.title).toContain("Quotes to Scrape");
        expect(page.h1).toContain("Quotes to Scrape");
        expect(page.contentHash).toMatch(/^[a-f0-9]{64}$/);
      }
    },
    LIVE_TIMEOUT_MS,
  );

  it(
    "documents current static-fetch gaps for JavaScript-rendered quote bodies",
    async () => {
      const urls = [
        `${QUOTES_ORIGIN}/js/`,
        `${QUOTES_ORIGIN}/scroll`,
        `${QUOTES_ORIGIN}/js-delayed/`,
      ];

      for (const url of urls) {
        const page = await fetchExtracted(url);
        expect(page.title).toBe("Quotes to Scrape");
        expect(page.h1).toBe("Quotes to Scrape");
        expect(page.description).toBeNull();
        expect(page.snippet).toBeNull();
        expect(page.links.some((link) => link.startsWith("/author/"))).toBe(false);
      }
    },
    LIVE_TIMEOUT_MS,
  );

  it(
    "renders valid llms.txt inventories from live Books and Quotes rows",
    async () => {
      const bookRows = await Promise.all(
        [
          `${BOOKS_ORIGIN}/`,
          `${BOOKS_ORIGIN}/catalogue/page-2.html`,
          `${BOOKS_ORIGIN}/catalogue/a-light-in-the-attic_1000/index.html`,
        ].map(liveRow),
      );
      const quoteRows = await Promise.all(
        [
          `${QUOTES_ORIGIN}/`,
          `${QUOTES_ORIGIN}/page/2/`,
          `${QUOTES_ORIGIN}/tableful/`,
          `${QUOTES_ORIGIN}/random`,
        ].map(liveRow),
      );

      const books = buildInventory(bookRows, BOOKS_ORIGIN);
      const quotes = buildInventory(quoteRows, QUOTES_ORIGIN);
      const booksOutput = render(books, books.homepageSnippet ?? "Books to Scrape catalogue.");
      const quotesOutput = render(quotes, quotes.homepageSnippet ?? "Quotes to Scrape pages.");

      expect(validate(booksOutput, BOOKS_ORIGIN)).toEqual({ ok: true });
      expect(validate(quotesOutput, QUOTES_ORIGIN)).toEqual({ ok: true });
      expect(booksOutput).toContain("A Light in the Attic");
      expect(quotesOutput).toContain("Quotes to Scrape");
    },
    LIVE_TIMEOUT_MS,
  );
});
