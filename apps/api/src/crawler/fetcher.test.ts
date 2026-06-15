import { afterEach, describe, expect, it, vi } from "vitest";
import { politeFetch } from "./fetcher";

function redirect(location: string): Response {
  return {
    url: "",
    status: 302,
    headers: new Headers({ location }),
    body: null,
  } as Response;
}

function ok(status = 200): Response {
  return {
    url: "",
    status,
    headers: new Headers(),
    body: null,
  } as Response;
}

describe("politeFetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects blocked initial hosts before fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(politeFetch("http://169.254.169.254/")).rejects.toThrow(/internal host/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects non-http schemes before fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(politeFetch("ftp://example.com")).rejects.toThrow("blocked non-http scheme");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects redirects to internal hosts before the next fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(redirect("http://169.254.169.254/"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(politeFetch("https://example.com")).rejects.toThrow(/internal host/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows redirects to public hosts", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(redirect("https://example.com/final"))
      .mockResolvedValueOnce(ok(200));
    vi.stubGlobal("fetch", fetchMock);

    await expect(politeFetch("https://example.com")).resolves.toMatchObject({ status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("allows public responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(ok(204))),
    );

    await expect(politeFetch("https://example.com")).resolves.toMatchObject({ status: 204 });
  });

  it("returns 304 responses without treating them as redirects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(ok(304))),
    );

    await expect(politeFetch("https://example.com")).resolves.toMatchObject({ status: 304 });
  });
});
