import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, hostedFileUrl, normalizeWebsiteUrl } from "./api";

const site = {
  id: "site_acme-dev",
  domain: "https://acme.dev",
  displayName: "Acme",
  monitoring: 0,
  checkIntervalS: 21600,
  nextCheckAt: null,
  changeStreak: 0,
  createdAt: 1_781_078_400,
};

describe("web API client", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:8787");
    vi.stubEnv("NEXT_PUBLIC_API_MOCK", "0");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("normalizes scheme-less website input before posting", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        siteId: "site_acme-dev",
        runId: "run_acme-dev_1",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.createSite(" acme.dev ");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8787/api/sites",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ url: "https://acme.dev" }),
      }),
    );
  });

  it("uses the Worker monitoring route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ site }));
    vi.stubGlobal("fetch", fetchMock);

    await api.setMonitoring(site.id, true);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8787/api/sites/site_acme-dev/monitoring",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ enabled: true }),
      }),
    );
  });

  it("encodes origins in hosted file URLs", () => {
    expect(normalizeWebsiteUrl("acme.dev")).toBe("https://acme.dev");
    expect(hostedFileUrl("https://acme.dev")).toBe(
      "http://localhost:8787/sites/https%3A%2F%2Facme.dev/llms.txt",
    );
  });
});
