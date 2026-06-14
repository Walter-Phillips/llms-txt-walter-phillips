import { describe, expect, it } from "vitest";
import { domainCandidates, unifiedDiff } from "./files";

describe("domainCandidates", () => {
  it("accepts encoded origins from public file URLs", () => {
    expect(domainCandidates("https%3A%2F%2FExample.com")).toEqual([
      "https://example.com",
      "https://Example.com",
    ]);
  });

  it("keeps legacy host-only domains as origin candidates", () => {
    expect(domainCandidates("example.com")).toEqual([
      "example.com",
      "https://example.com",
      "http://example.com",
    ]);
  });
});

describe("unifiedDiff", () => {
  it("returns empty string for identical content", () => {
    expect(unifiedDiff("a\nb\nc\n", "a\nb\nc\n", "v1", "v2")).toBe("");
  });

  it("emits labels, hunk header, and +/- lines for a single change", () => {
    const out = unifiedDiff("a\nb\nc\n", "a\nB\nc\n", "llms.txt v1", "llms.txt v2");
    expect(out).toBe(
      [
        "--- llms.txt v1",
        "+++ llms.txt v2",
        "@@ -1,3 +1,3 @@",
        " a",
        "-b",
        "+B",
        " c",
        "",
      ].join("\n"),
    );
  });

  it("handles pure additions at the end", () => {
    const out = unifiedDiff("a\nb\n", "a\nb\nc\nd\n", "v1", "v2");
    expect(out).toContain("@@ -1,2 +1,4 @@");
    expect(out).toContain("+c");
    expect(out).toContain("+d");
    expect(out).not.toContain("-a");
  });

  it("handles pure removals", () => {
    const out = unifiedDiff("a\nb\nc\n", "a\nc\n", "v1", "v2");
    expect(out).toContain("-b");
    expect(out).not.toContain("+b");
    expect(out).toContain("@@ -1,3 +1,2 @@");
  });

  it("uses zero-count convention when one side is empty", () => {
    const out = unifiedDiff("", "x\ny\n", "v1", "v2");
    expect(out).toContain("@@ -0,0 +1,2 @@");
    expect(out).toContain("+x");
    expect(out).toContain("+y");
  });

  it("splits distant changes into separate hunks with correct offsets", () => {
    const from = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join("\n") + "\n";
    const to = from.replace("line2", "LINE2").replace("line18", "LINE18");
    const out = unifiedDiff(from, to, "v1", "v2");
    const headers = out.split("\n").filter((l) => l.startsWith("@@"));
    expect(headers).toEqual(["@@ -1,5 +1,5 @@", "@@ -15,6 +15,6 @@"]);
    expect(out).toContain("-line2");
    expect(out).toContain("+LINE2");
    expect(out).toContain("-line18");
    expect(out).toContain("+LINE18");
  });

  it("merges nearby changes into one hunk", () => {
    const from = "a\nb\nc\nd\ne\nf\n";
    const to = "a\nB\nc\nd\nE\nf\n";
    const out = unifiedDiff(from, to, "v1", "v2");
    const headers = out.split("\n").filter((l) => l.startsWith("@@"));
    expect(headers).toEqual(["@@ -1,6 +1,6 @@"]);
  });

  it("limits context to 3 equal lines around a change", () => {
    const from = Array.from({ length: 11 }, (_, i) => `l${i + 1}`).join("\n") + "\n";
    const to = from.replace("l6", "L6");
    const out = unifiedDiff(from, to, "v1", "v2");
    expect(out).toContain("@@ -3,7 +3,7 @@");
    expect(out).not.toContain(" l1");
    expect(out).not.toContain(" l11");
  });
});
