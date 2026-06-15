import { describe, expect, it } from "vitest";
import { parseRobots } from "./robots";

describe("parseRobots", () => {
  it("extracts sitemap directives regardless of group", () => {
    const rules = parseRobots(
      ["User-agent: *", "Disallow: /admin", "", "Sitemap: https://example.com/sitemap.xml"].join(
        "\n",
      ),
    );
    expect(rules.sitemaps).toEqual(["https://example.com/sitemap.xml"]);
    expect(rules.disallow).toEqual(["/admin"]);
  });

  it("prefers our UA group over the wildcard group", () => {
    const rules = parseRobots(
      [
        "User-agent: *",
        "Disallow: /everything",
        "",
        "User-agent: llms-txt-generator",
        "Disallow: /private",
      ].join("\n"),
    );
    expect(rules.disallow).toEqual(["/private"]);
  });

  it("applies shared rules to consecutive user-agent lines", () => {
    const rules = parseRobots(["User-agent: foo", "User-agent: *", "Disallow: /shared"].join("\n"));
    expect(rules.disallow).toEqual(["/shared"]);
  });

  it("clamps crawl-delay between 500ms and 10s", () => {
    expect(parseRobots("User-agent: *\nCrawl-delay: 0.1").crawlDelayMs).toBe(500);
    expect(parseRobots("User-agent: *\nCrawl-delay: 2").crawlDelayMs).toBe(2000);
    expect(parseRobots("User-agent: *\nCrawl-delay: 60").crawlDelayMs).toBe(10_000);
  });

  it("ignores comments and malformed lines", () => {
    const rules = parseRobots(
      ["# a comment", "User-agent: *", "Disallow: /a # trailing", "nonsense line"].join("\n"),
    );
    expect(rules.disallow).toEqual(["/a"]);
  });

  it("returns defaults for empty input", () => {
    const rules = parseRobots("");
    expect(rules).toEqual({ disallow: [], crawlDelayMs: 500, sitemaps: [] });
  });
});
