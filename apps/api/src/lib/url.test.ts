import { describe, expect, it } from "vitest";
import { normalizeOrigin, normalizeUrl } from "./url";

describe("normalizeOrigin", () => {
  it("strips path and lowercases host", () => {
    expect(normalizeOrigin("https://Example.com/foo/bar")).toBe("https://example.com");
  });

  it("rejects localhost", () => {
    expect(normalizeOrigin("http://localhost:3000")).toBeNull();
  });

  it("rejects private IPs", () => {
    expect(normalizeOrigin("http://10.0.0.1")).toBeNull();
    expect(normalizeOrigin("http://192.168.1.1")).toBeNull();
    expect(normalizeOrigin("http://172.16.0.1")).toBeNull();
  });

  it("rejects non-http schemes", () => {
    expect(normalizeOrigin("ftp://example.com")).toBeNull();
    expect(normalizeOrigin("javascript:alert(1)")).toBeNull();
  });
});

describe("normalizeUrl", () => {
  it("strips utm params and fragments", () => {
    const u = normalizeUrl("https://example.com/a?utm_source=x&q=1#frag");
    expect(u).toBe("https://example.com/a?q=1");
  });

  it("canonicalizes trailing slash but keeps root /", () => {
    expect(normalizeUrl("https://example.com/foo/")).toBe("https://example.com/foo");
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com/");
  });
});
