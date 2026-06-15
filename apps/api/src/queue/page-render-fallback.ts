import type { CrawlMessage, Environment } from "../bindings";
import { extract, type ExtractedPage } from "../crawler/extract";
import {
  assessExtractionQuality,
  renderedExtractionIsBetter,
  type ExtractionQuality,
} from "../crawler/extraction-quality";
import { renderWithBrowser, type RenderedPage } from "../crawler/rendered-fetcher";
import { logInfo, logWarn, urlFields } from "../observability/logger";

type PageMessage = Extract<CrawlMessage, { type: "page" }>;

export interface RenderFallback {
  browser: Environment["BROWSER"] | undefined;
  claimRender: () => Promise<boolean>;
}

export interface ExtractedPageResult {
  page: ExtractedPage;
  source: "static" | "rendered";
  quality: ExtractionQuality;
  browserMsUsed: number | null;
}

/**
 * Extract static HTML first and use Browser Run only when static output is thin.
 *
 * @param input Extraction context.
 * @param input.body Static HTML response body.
 * @param input.message Page crawl message.
 * @param input.renderFallback Optional Browser Run fallback hooks.
 * @returns Best extracted page metadata for persistence.
 */
export async function extractBestPage(input: {
  body: ReadableStream<Uint8Array>;
  message: PageMessage;
  renderFallback?: RenderFallback;
}): Promise<ExtractedPageResult> {
  const staticPage = await extract(input.body);
  const context = contextFor(input.message);
  const quality = assessExtractionQuality(staticPage, context);
  if (!quality.shouldRenderFallback) return staticResult(staticPage, quality);
  if (!input.renderFallback) return staticResult(staticPage, quality);
  if (!input.renderFallback.browser)
    return missingBindingResult(input.message, staticPage, quality);

  const accepted = await claimBrowserRender(
    input.message,
    input.renderFallback.claimRender,
    quality,
  );
  if (!accepted) return staticResult(staticPage, quality);

  const rendered = await renderBrowserPage(input.message, input.renderFallback.browser, quality);
  if (!rendered) return staticResult(staticPage, quality);
  return chooseRenderedOrStatic(input.message, staticPage, rendered, quality);
}

function contextFor(message: PageMessage): {
  url: string;
  depth: number;
  followLinks: boolean;
} {
  return {
    url: message.url,
    depth: message.depth,
    followLinks: message.followLinks === true,
  };
}

function staticResult(page: ExtractedPage, quality: ExtractionQuality): ExtractedPageResult {
  return { page, source: "static", quality, browserMsUsed: null };
}

function missingBindingResult(
  message: PageMessage,
  page: ExtractedPage,
  quality: ExtractionQuality,
): ExtractedPageResult {
  logRenderOutcome(message, "browser_fallback_skipped", quality, {
    fallbackSkipReason: "missing_binding",
  });
  return staticResult(page, quality);
}

async function claimBrowserRender(
  message: PageMessage,
  claimRender: () => Promise<boolean>,
  quality: ExtractionQuality,
): Promise<boolean> {
  try {
    const accepted = await claimRender();
    if (!accepted) {
      logRenderOutcome(message, "browser_fallback_skipped", quality, {
        fallbackSkipReason: "budget_exhausted",
      });
    }
    return accepted;
  } catch (error) {
    logWarn("browser_fallback_claim_failed", {
      workflow: "crawl",
      step: "browser_render",
      outcome: "skipped",
      fallbackReason: quality.reasons.join(","),
      error: error instanceof Error ? error.message : String(error),
      siteId: message.siteId,
      runId: message.runId,
      ...urlFields(message.url),
    });
    return false;
  }
}

async function renderBrowserPage(
  message: PageMessage,
  browser: NonNullable<Environment["BROWSER"]>,
  quality: ExtractionQuality,
): Promise<RenderedPage | null> {
  try {
    return await renderWithBrowser(browser, message.url);
  } catch (error) {
    logWarn("browser_fallback_failed", {
      workflow: "crawl",
      step: "browser_render",
      outcome: "failed",
      fallbackReason: quality.reasons.join(","),
      error: error instanceof Error ? error.message : String(error),
      siteId: message.siteId,
      runId: message.runId,
      ...urlFields(message.url),
    });
    return null;
  }
}

function chooseRenderedOrStatic(
  message: PageMessage,
  staticPage: ExtractedPage,
  rendered: RenderedPage,
  staticQuality: ExtractionQuality,
): ExtractedPageResult {
  const context = contextFor(message);
  if (!renderedExtractionIsBetter(staticPage, rendered.page, context)) {
    logRenderOutcome(message, "browser_fallback_rejected", staticQuality, {
      renderedLinkCount: rendered.page.links.length,
      browserMsUsed: rendered.browserMsUsed,
    });
    return { ...staticResult(staticPage, staticQuality), browserMsUsed: rendered.browserMsUsed };
  }

  const renderedQuality = assessExtractionQuality(rendered.page, context);
  logRenderOutcome(message, "browser_fallback_accepted", staticQuality, {
    renderedLinkCount: rendered.page.links.length,
    renderedCrawlableLinkCount: renderedQuality.crawlableLinkCount,
    browserMsUsed: rendered.browserMsUsed,
  });
  return {
    page: rendered.page,
    source: "rendered",
    quality: renderedQuality,
    browserMsUsed: rendered.browserMsUsed,
  };
}

function logRenderOutcome(
  message: PageMessage,
  outcome: string,
  quality: ExtractionQuality,
  fields: Record<string, string | number | boolean | null>,
): void {
  logInfo("crawl_page_fetched", {
    workflow: "crawl",
    step: "page_fetch",
    outcome,
    siteId: message.siteId,
    runId: message.runId,
    depth: message.depth,
    ...urlFields(message.url),
    fallbackReason: quality.reasons.join(","),
    ...fields,
  });
}
