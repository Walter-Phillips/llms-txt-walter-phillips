import type { Inventory } from "./heuristics";

// Spec: H1 title, blockquote summary, optional free-form paragraphs, then
// ## sections of `- [title](url): description`, with `## Optional` last.
export function render(inv: Inventory, summary: string): string {
  const lines: string[] = [];
  lines.push(`# ${inv.siteName}`);
  lines.push("");
  lines.push(`> ${summary}`);
  lines.push("");

  for (const section of inv.sections) {
    if (section.pages.length === 0) continue;
    lines.push(`## ${section.name}`);
    for (const p of section.pages) {
      const title = p.title ?? p.h1 ?? p.url;
      const desc = p.description ?? "";
      lines.push(`- [${title}](${p.url}): ${desc}`);
    }
    lines.push("");
  }

  if (inv.optional.length > 0) {
    lines.push(`## Optional`);
    for (const p of inv.optional) {
      const title = p.title ?? p.h1 ?? p.url;
      const desc = p.description ?? "";
      lines.push(`- [${title}](${p.url}): ${desc}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
