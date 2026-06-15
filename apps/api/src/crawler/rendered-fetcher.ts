import type { BrowserRunBinding } from "../bindings";
import { extract, type ExtractedPage } from "./extract";
import { readBodyText } from "./fetcher";

const MAX_RENDERED_RESPONSE_BYTES = 3 * 1024 * 1024;
const RENDER_TIMEOUT_MS = 10_000;

interface BrowserSnapshotPayload {
  success?: boolean;
  result?: {
    content?: unknown;
  };
}

export interface RenderedPage {
  page: ExtractedPage;
  browserMsUsed: number | null;
}

/**
 * Render a URL through Cloudflare Browser Run and extract metadata from the
 * resulting DOM HTML.
 *
 * @param browser Browser Run Worker binding.
 * @param url URL to render.
 * @returns Extracted rendered page, or null when Browser Run returns no HTML.
 */
export async function renderWithBrowser(
  browser: BrowserRunBinding,
  url: string,
): Promise<RenderedPage | null> {
  const response = await browser.quickAction("snapshot", {
    url,
    formats: ["content", "markdown"],
    gotoOptions: {
      waitUntil: "networkidle",
      timeout: RENDER_TIMEOUT_MS,
    },
  });
  if (!response.ok || !response.body) return null;

  const payload = parseSnapshotPayload(
    await readBodyText(response.body, MAX_RENDERED_RESPONSE_BYTES),
  );
  const html = payload?.result?.content;
  if (typeof html !== "string" || html.trim() === "") return null;

  const body = new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  }).body;
  if (!body) return null;

  return {
    page: await extract(body),
    browserMsUsed: browserMsUsed(response),
  };
}

function parseSnapshotPayload(raw: string): BrowserSnapshotPayload | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isSnapshotPayload(parsed)) return parsed;
  } catch {
    return null;
  }
  return null;
}

function isSnapshotPayload(value: unknown): value is BrowserSnapshotPayload {
  return Boolean(value && typeof value === "object");
}

function browserMsUsed(response: Response): number | null {
  const value = Number.parseInt(response.headers.get("x-browser-ms-used") ?? "", 10);
  return Number.isFinite(value) ? value : null;
}
