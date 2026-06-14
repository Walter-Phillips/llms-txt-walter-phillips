import { describe, expect, it } from "vitest";
import { normalizeOrigin, normalizeUrl, urlPathDepth } from "./url";

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

  it("rejects internal and encoded host forms", () => {
    expect(normalizeOrigin("http://[::1]/")).toBeNull();
    expect(normalizeOrigin("http://[fe80::1]/")).toBeNull();
    expect(normalizeOrigin("http://[fd00::1]/")).toBeNull();
    expect(normalizeOrigin("http://[::ffff:127.0.0.1]/")).toBeNull();
    expect(normalizeOrigin("http://2130706433/")).toBeNull();
    expect(normalizeOrigin("http://0x7f000001/")).toBeNull();
    expect(normalizeOrigin("http://127.0.0.1/")).toBeNull();
    expect(normalizeOrigin("http://169.254.169.254/")).toBeNull();
    expect(normalizeOrigin("http://10.1.2.3/")).toBeNull();
    expect(normalizeOrigin("http://100.64.1.1/")).toBeNull();
  });

  it("allows public hosts and public IPs", () => {
    expect(normalizeOrigin("https://example.com/path")).toBe("https://example.com");
    expect(normalizeOrigin("http://1.2.3.4/")).toBe("http://1.2.3.4");
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

describe("urlPathDepth", () => {
  it("counts non-empty path segments", () => {
    expect(urlPathDepth("https://x.test/")).toBe(0);
    expect(urlPathDepth("https://x.test/a")).toBe(1);
    expect(urlPathDepth("https://x.test/a/b/")).toBe(2);
  });

  it("sorts unparseable URLs last", () => {
    expect(urlPathDepth("not a url")).toBe(Number.MAX_SAFE_INTEGER);
  });
});
