import type { GeneratedSite } from "@profound-takehome/shared";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { GenerationBrowser } from "./generation-browser";
import type * as ApiModule from "@/lib/api";

const { getGeneratedSitesMock } = vi.hoisted(() => ({
  getGeneratedSitesMock: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const apiModule = await importOriginal<typeof ApiModule>();
  return { ...apiModule, api: { ...apiModule.api, getGeneratedSites: getGeneratedSitesMock } };
});

const generatedSite: GeneratedSite = {
  site: {
    id: "site_acme",
    domain: "https://acme.dev",
    displayName: "Acme",
    monitoring: 1,
    checkIntervalS: 86400,
    nextCheckAt: 1781524800,
    changeStreak: 0,
    createdAt: 1781438400,
  },
  latestVersion: {
    id: "ver_2",
    siteId: "site_acme",
    runId: "run_2",
    version: 2,
    r2Key: "site_acme/v2.txt",
    changeSummary: "1 page added",
    generatedBy: "heuristic",
    createdAt: 1781438500,
  },
};

beforeEach(() => {
  getGeneratedSitesMock.mockReset().mockResolvedValue({ sites: [generatedSite] });
});

it("opens existing generated files without a run query", async () => {
  render(<GenerationBrowser />);

  expect(await screen.findByText("acme.dev")).toBeInTheDocument();
  expect(screen.getByText("v2")).toBeInTheDocument();
  expect(screen.getByText("1 page added")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /open/i })).toHaveAttribute("href", "/sites/site_acme");
  expect(screen.getByRole("link", { name: /raw/i })).toHaveAttribute(
    "href",
    "http://localhost:8787/sites/https%3A%2F%2Facme.dev/llms.txt",
  );
});

it("searches generated sites through the read-only API", async () => {
  render(<GenerationBrowser />);
  await screen.findByText("acme.dev");

  fireEvent.change(screen.getByLabelText("Search generated sites"), {
    target: { value: "stripe.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: /search/i }));

  await waitFor(() => {
    expect(getGeneratedSitesMock).toHaveBeenLastCalledWith("stripe.com");
  });
});
