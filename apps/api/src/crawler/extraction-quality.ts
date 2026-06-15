import type { ExtractedPage } from "./extract";
import { shouldCrawl } from "./frontier";
import { normalizeUrl } from "../lib/url";

const MIN_USEFUL_SNIPPET_CHARS = 80;
const MIN_DISCOVERY_LINKS = 3;
const GENERIC_TITLES = new Set(["", "app", "home", "loading", "untitled"]);

export interface ExtractionQualityContext {
  url: string;
  depth: number;
  followLinks: boolean;
}

export interface ExtractionQuality {
  usefulSnippet: boolean;
  crawlableLinkCount: number;
  reasons: string[];
  shouldRenderFallback: boolean;
}

/**
 * Score whether static HTML extraction is rich enough to skip browser rendering.
 *
 * @param page Metadata extracted from the static HTML response.
 * @param context Crawl context for the page.
 * @returns Quality signals and fallback decision.
 */
export function assessExtractionQuality(
  page: ExtractedPage,
  context: ExtractionQualityContext,
): ExtractionQuality {
  const usefulSnippet = (page.snippet?.trim().length ?? 0) >= MIN_USEFUL_SNIPPET_CHARS;
  const crawlableLinkCount = countCrawlableSameOriginLinks(page.links, context.url);
  const reasons = qualityReasons(page, context, usefulSnippet, crawlableLinkCount);

  return {
    usefulSnippet,
    crawlableLinkCount,
    reasons,
    shouldRenderFallback: reasons.includes("thin_content") || reasons.includes("few_static_links"),
  };
}

function qualityReasons(
  page: ExtractedPage,
  context: ExtractionQualityContext,
  usefulSnippet: boolean,
  crawlableLinkCount: number,
): string[] {
  const reasons: string[] = [];
  if (isThinContent(page, usefulSnippet)) reasons.push("thin_content");
  if (hasGenericHeading(page)) reasons.push("generic_heading");
  if (hasFewDiscoveryLinks(context, crawlableLinkCount)) reasons.push("few_static_links");
  return reasons;
}

/**
 * Prefer rendered output only when it materially improves static extraction.
 *
 * @param staticPage Static extraction result.
 * @param renderedPage Browser-rendered extraction result.
 * @param context Crawl context for the page.
 * @returns Whether rendered output should replace the static result.
 */
export function renderedExtractionIsBetter(
  staticPage: ExtractedPage,
  renderedPage: ExtractedPage,
  context: ExtractionQualityContext,
): boolean {
  const staticQuality = assessExtractionQuality(staticPage, context);
  const renderedQuality = assessExtractionQuality(renderedPage, context);
  const gainedContent =
    !staticQuality.usefulSnippet &&
    ((renderedPage.snippet?.trim().length ?? 0) > (staticPage.snippet?.trim().length ?? 0) ||
      Boolean(renderedPage.description && !staticPage.description));
  const gainedLinks = renderedQuality.crawlableLinkCount > staticQuality.crawlableLinkCount;

  return gainedContent || gainedLinks;
}

function countCrawlableSameOriginLinks(links: string[], baseUrl: string): number {
  const origin = new URL(baseUrl).origin;
  const seen = new Set<string>();
  for (const link of links) {
    const normalized = normalizeUrl(link, baseUrl);
    if (!normalized) continue;
    const parsed = new URL(normalized);
    if (parsed.origin !== origin) continue;
    if (!shouldCrawl(parsed.pathname, [])) continue;
    seen.add(normalized);
  }
  return seen.size;
}

function isThinContent(page: ExtractedPage, usefulSnippet: boolean): boolean {
  return !page.description?.trim() && !usefulSnippet;
}

function hasGenericHeading(page: ExtractedPage): boolean {
  return isGeneric(page.title) && isGeneric(page.h1);
}

function hasFewDiscoveryLinks(
  context: ExtractionQualityContext,
  crawlableLinkCount: number,
): boolean {
  return context.followLinks && crawlableLinkCount < MIN_DISCOVERY_LINKS;
}

function isGeneric(value: string | null): boolean {
  const normalized = value?.trim().toLowerCase() ?? "";
  return GENERIC_TITLES.has(normalized);
}
