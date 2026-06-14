import type { Site } from "@profound-takehome/shared";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ResultView } from "./result-view";

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getSite: vi.fn(),
    getLlmsTxt: vi.fn(),
    setMonitoring: vi.fn(),
    getPages: vi.fn()
  }
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/api")>();
  return { ...mod, api: { ...mod.api, ...apiMock } };
});

const site: Site = {
  id: "site_acme-dev",
  domain: "https://acme.dev",
  displayName: "Acme",
  monitoring: 0,
  checkIntervalS: 21600,
  nextCheckAt: null,
  changeStreak: 0,
  createdAt: Date.now()
};

const CONTENT = `# Acme\n\n> Acme builds developer tooling.\n\n## Docs\n\n- [Quickstart](https://acme.dev/docs/quickstart): Ship fast\n`;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:8787");
  apiMock.getSite.mockReset().mockResolvedValue({
    site,
    latestVersion: {
      id: "ver_1",
      siteId: site.id,
      runId: "run_1",
      version: 3,
      r2Key: "https://acme.dev/llms.txt/v3",
      changeSummary: "1 page added",
      createdAt: Date.now()
    }
  });
  apiMock.getLlmsTxt.mockReset().mockResolvedValue(CONTENT);
  apiMock.setMonitoring.mockReset();
  apiMock.getPages.mockReset().mockResolvedValue({
    pages: [
      {
        url: "https://acme.dev/docs/quickstart",
        title: "Quickstart",
        description: null,
        sectionHint: "Docs",
        status: "ok"
      }
    ]
  });
});

it("renders the file, version, and hosted URL", async () => {
  render(<ResultView siteId={site.id} />);

  expect(await screen.findByText("# Acme")).toBeInTheDocument();
  expect(screen.getByText("Quickstart")).toBeInTheDocument(); // highlighted link label
  expect(screen.getByText(/v3/)).toBeInTheDocument();
  expect(apiMock.getLlmsTxt).toHaveBeenCalledWith("https://acme.dev");
  expect(
    screen.getByRole("link", {
      name: "http://localhost:8787/sites/https%3A%2F%2Facme.dev/llms.txt"
    })
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Download" })).toBeInTheDocument();
});

it("toggles monitoring and shows the cadence", async () => {
  apiMock.setMonitoring.mockResolvedValue({
    site: { ...site, monitoring: 1, nextCheckAt: Date.now() + 21600 * 1000 },
    latestVersion: null
  });
  render(<ResultView siteId={site.id} />);

  const toggle = await screen.findByRole("switch", { name: "Keep this updated" });
  expect(toggle).toHaveAttribute("aria-checked", "false");

  fireEvent.click(toggle);

  await waitFor(() => expect(apiMock.setMonitoring).toHaveBeenCalledWith(site.id, true));
  await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
  expect(screen.getByText(/checking every 6 hours/i)).toBeInTheDocument();
});

it("expands the page inventory table on demand", async () => {
  render(<ResultView siteId={site.id} />);
  await screen.findByText("# Acme");

  fireEvent.click(screen.getByRole("button", { name: /page inventory/i }));

  const table = await screen.findByRole("table");
  expect(within(table).getByText("https://acme.dev/docs/quickstart")).toBeInTheDocument();
  expect(within(table).getByText("ok")).toBeInTheDocument();
});
