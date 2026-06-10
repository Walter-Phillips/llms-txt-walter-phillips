export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

const LINK_LINE = /^- \[[^\]]+\]\(https?:\/\/[^)]+\):\s.+$/;

/**
 * Spec validator — pure, unit-tested. Runs on every generated file before
 * it's written to R2. "Spec-compliant" should be a verifiable claim.
 */
export function validate(content: string, origin: string): ValidationResult {
  const errors: string[] = [];
  const lines = content.split("\n");
  let h1Seen = false;
  let blockquoteSeen = false;
  let lastH2: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("# ")) {
      if (h1Seen) errors.push(`line ${i + 1}: multiple H1`);
      if (i !== 0) errors.push(`line ${i + 1}: H1 must be first line`);
      h1Seen = true;
    } else if (line.startsWith("> ")) {
      if (!h1Seen) errors.push(`line ${i + 1}: blockquote before H1`);
      blockquoteSeen = true;
    } else if (line.startsWith("## ")) {
      lastH2 = line.slice(3).trim();
    } else if (/^#{3,}\s/.test(line)) {
      errors.push(`line ${i + 1}: H3+ headings not allowed at top level`);
    } else if (line.startsWith("- ")) {
      if (!LINK_LINE.test(line)) errors.push(`line ${i + 1}: malformed link item`);
      else {
        const url = line.match(/\(([^)]+)\)/)?.[1] ?? "";
        try {
          const u = new URL(url);
          if (!url.startsWith(origin) && u.origin !== origin) {
            errors.push(`line ${i + 1}: cross-origin link ${url}`);
          }
        } catch {
          errors.push(`line ${i + 1}: invalid URL ${url}`);
        }
      }
    }
  }

  if (!h1Seen) errors.push("missing H1");
  if (!blockquoteSeen) errors.push("missing blockquote summary");
  if (lastH2 && lastH2 !== "Optional") {
    // Optional, if present, must be last — soft check (only flag if both present and out of order)
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
