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
  let optionalSeenAt: number | null = null;

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
      const name = line.slice(3).trim();
      if (optionalSeenAt !== null) {
        errors.push(`line ${i + 1}: section "${name}" after ## Optional — Optional must be last`);
      }
      if (name === "Optional") {
        if (optionalSeenAt !== null) errors.push(`line ${i + 1}: duplicate ## Optional section`);
        optionalSeenAt = i;
      }
    } else if (/^#{3,}\s/.test(line)) {
      errors.push(`line ${i + 1}: H3+ headings not allowed at top level`);
    } else if (line.startsWith("- ")) {
      if (!LINK_LINE.test(line)) errors.push(`line ${i + 1}: malformed link item`);
      else {
        // Anchor on the scheme so parentheses in the link title don't match.
        const url = line.match(/\((https?:\/\/[^)]+)\)/)?.[1] ?? "";
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

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
