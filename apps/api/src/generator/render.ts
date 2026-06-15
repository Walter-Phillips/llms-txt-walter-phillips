import type { Inventory, InventoryPage } from "./heuristics";

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Markdown link labels can't contain square brackets; swap for parens.
 * @param p Page metadata to render.
 * @returns Markdown-safe link label.
 */
function linkTitle(p: InventoryPage): string {
  const raw = p.title ?? p.h1 ?? p.url;
  const cleaned = clean(raw).replace(/\[/g, "(").replace(/\]/g, ")");
  return cleaned.length > 0 ? cleaned : p.url;
}

/**
 * Unencoded ")" in a URL terminates the markdown link; percent-encode it.
 * @param url Absolute URL for the link target.
 * @returns URL safe for markdown link syntax.
 */
function linkUrl(url: string): string {
  return url.replace(/\)/g, "%29").replace(/\(/g, "%28");
}

/**
 * The spec line format is `- [title](url): desc` — a description is always
 * required, so synthesize a minimal one from title/section when missing.
 * @param p Page metadata to describe.
 * @param section Current rendered section name.
 * @param title Rendered link title.
 * @returns Non-empty link description.
 */
function linkDescription(p: InventoryPage, section: string, title: string): string {
  const desc = p.description ? clean(p.description) : "";
  if (desc.length > 0) return desc;
  return `${title} (${section}).`;
}

function pushLinks(lines: string[], pages: InventoryPage[], section: string): void {
  for (const p of pages) {
    const title = linkTitle(p);
    lines.push(`- [${title}](${linkUrl(p.url)}): ${linkDescription(p, section, title)}`);
  }
}

// Spec: H1 title, blockquote summary, optional free-form paragraphs, then
// ## sections of `- [title](url): description`, with `## Optional` last.
/**
 * Render an inventory into llms.txt markdown.
 * @param inv Inventory to render.
 * @param summary Homepage summary shown in the blockquote.
 * @returns Spec-shaped llms.txt content.
 */
export function render(inv: Inventory, summary: string): string {
  const lines: string[] = [];
  lines.push(`# ${clean(inv.siteName)}`);
  lines.push("");
  lines.push(`> ${clean(summary)}`);
  lines.push("");

  for (const section of inv.sections) {
    if (section.pages.length === 0) continue;
    lines.push(`## ${clean(section.name)}`);
    pushLinks(lines, section.pages, section.name);
    lines.push("");
  }

  if (inv.optional.length > 0) {
    lines.push(`## Optional`);
    pushLinks(lines, inv.optional, "Optional");
    lines.push("");
  }

  return lines.join("\n");
}
