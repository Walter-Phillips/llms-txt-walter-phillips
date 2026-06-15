import { describe, expect, it } from "vitest";
import { validate } from "./validate";

const ORIGIN = "https://example.com";

const GOOD = [
  "# Acme",
  "",
  "> Acme makes widgets.",
  "",
  "## Documentation",
  "- [Docs](https://example.com/docs): Documentation home.",
  "",
  "## Optional",
  "- [Privacy](https://example.com/privacy): Privacy policy.",
  "",
].join("\n");

describe("validate", () => {
  it("accepts a spec-compliant file", () => {
    expect(validate(GOOD, ORIGIN)).toEqual({ ok: true });
  });

  it("rejects missing H1", () => {
    const res = validate("> summary only\n", ORIGIN);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join()).toMatch(/missing H1/);
  });

  it("rejects H1 not on line 1", () => {
    const res = validate("intro\n# Acme\n> s\n", ORIGIN);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join()).toMatch(/H1 must be first line/);
  });

  it("rejects multiple H1s", () => {
    const res = validate("# Acme\n> s\n# Again\n", ORIGIN);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join()).toMatch(/multiple H1/);
  });

  it("rejects missing blockquote", () => {
    const res = validate("# Acme\n", ORIGIN);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join()).toMatch(/missing blockquote/);
  });

  it("rejects H3+ headings", () => {
    const res = validate("# Acme\n> s\n### Sub\n", ORIGIN);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join()).toMatch(/H3\+/);
  });

  it("rejects malformed link items (missing description)", () => {
    const res = validate("# Acme\n> s\n## Docs\n- [Docs](https://example.com/docs)\n", ORIGIN);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join()).toMatch(/malformed link item/);
  });

  it("rejects cross-origin links", () => {
    const res = validate(
      "# Acme\n> s\n## Docs\n- [Other](https://other.com/x): Off-site.\n",
      ORIGIN,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join()).toMatch(/cross-origin/);
  });

  it("rejects sections after ## Optional", () => {
    const out = [
      "# Acme",
      "> s",
      "## Optional",
      "- [Privacy](https://example.com/privacy): Policy.",
      "## Docs",
      "- [Docs](https://example.com/docs): Docs.",
    ].join("\n");
    const res = validate(out, ORIGIN);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join()).toMatch(/Optional must be last/);
  });

  it("allows parentheses in link titles", () => {
    const out = "# Acme\n> s\n## Docs\n- [Docs (v2)](https://example.com/docs): Docs.\n";
    expect(validate(out, ORIGIN)).toEqual({ ok: true });
  });
});
