import { afterEach, describe, expect, it, vi } from "vitest";
import { politeFetch } from "./fetcher";

function response(url: string, status = 200): Response {
  return {
    url,
    status,
    headers: new Headers(),
    body: null
  } as Response;
}

describe("politeFetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects redirects to internal hosts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response("http://169.254.169.254/"))
    );

    await expect(politeFetch("https://example.com")).rejects.toThrow(
      "blocked redirect to internal host"
    );
  });

  it("allows public final URLs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response("https://example.com/final", 204))
    );

    await expect(politeFetch("https://example.com")).resolves.toMatchObject({ status: 204 });
  });
});
