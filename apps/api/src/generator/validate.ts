export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

const LINK_LINE = /^- \[[^\]]+\]\(https?:\/\/[^)]+\):\s.+$/;

function lineNumber(index: number): string {
  return String(index + 1);
}

function validateHeading(
  line: string,
  index: number,
  state: { h1Seen: boolean; optionalSeenAt: number | null },
  errors: string[],
): void {
  if (line.startsWith("# ")) {
    if (state.h1Seen) errors.push(`line ${lineNumber(index)}: multiple H1`);
    if (index !== 0) errors.push(`line ${lineNumber(index)}: H1 must be first line`);
    state.h1Seen = true;
    return;
  }

  if (!line.startsWith("## ")) return;
  const name = line.slice(3).trim();
  if (state.optionalSeenAt !== null) {
    errors.push(
      `line ${lineNumber(index)}: section "${name}" after ## Optional — Optional must be last`,
    );
  }
  if (name === "Optional") {
    if (state.optionalSeenAt !== null) {
      errors.push(`line ${lineNumber(index)}: duplicate ## Optional section`);
    }
    state.optionalSeenAt = index;
  }
}

function validateLinkLine(line: string, index: number, origin: string): string[] {
  if (!LINK_LINE.test(line)) return [`line ${lineNumber(index)}: malformed link item`];

  const url = /\((https?:\/\/[^)]+)\)/.exec(line)?.[1] ?? "";
  try {
    const parsedUrl = new URL(url);
    return url.startsWith(origin) || parsedUrl.origin === origin
      ? []
      : [`line ${lineNumber(index)}: cross-origin link ${url}`];
  } catch {
    return [`line ${lineNumber(index)}: invalid URL ${url}`];
  }
}

/**
 * Spec validator — pure, unit-tested. Runs on every generated file before
 * it's written to R2. "Spec-compliant" should be a verifiable claim.
 * @param content Candidate llms.txt content.
 * @param origin Site origin that all generated links must match.
 * @returns Validation success or a list of spec errors.
 */
export function validate(content: string, origin: string): ValidationResult {
  const errors: string[] = [];
  const lines = content.split("\n");
  let blockquoteSeen = false;
  const state = { h1Seen: false, optionalSeenAt: null as number | null };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    validateHeading(line, i, state, errors);
    if (line.startsWith("> ")) {
      if (!state.h1Seen) errors.push(`line ${lineNumber(i)}: blockquote before H1`);
      blockquoteSeen = true;
    } else if (/^#{3,}\s/.test(line)) {
      errors.push(`line ${lineNumber(i)}: H3+ headings not allowed at top level`);
    } else if (line.startsWith("- ")) {
      errors.push(...validateLinkLine(line, i, origin));
    }
  }

  if (!state.h1Seen) errors.push("missing H1");
  if (!blockquoteSeen) errors.push("missing blockquote summary");

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
