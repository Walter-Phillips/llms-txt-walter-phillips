import type { Site } from "@profound-takehome/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ResultView } from "./result-view";
import type * as ApiModule from "@/lib/api";

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getSite: vi.fn(),
    getLlmsTxt: vi.fn(),
    getPages: vi.fn(),
    getVersions: vi.fn(),
  },
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const apiModule = await importOriginal<typeof ApiModule>();
  return { ...apiModule, api: { ...apiModule.api, ...apiMock } };
});

const site: Site = {
  id: "site_acme-dev",
  domain: "https://acme.dev",
  displayName: "Acme",
  monitoring: 0,
  checkIntervalS: 21600,
  nextCheckAt: null,
  changeStreak: 0,
  createdAt: Date.now(),
};

const CONTENT = `# Acme\n\n> Acme builds developer tooling.\n\n## Docs\n\n- [Quickstart](https://acme.dev/docs/quickstart): Ship fast\n`;

function makeVersion(version: number) {
  return {
    id: `ver_${String(version)}`,
    siteId: site.id,
    runId: "run_1",
    version,
    r2Key: `https://acme.dev/llms.txt/v${String(version)}`,
    changeSummary: "1 page added",
    createdAt: Date.now(),
  };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:8787");
  apiMock.getSite.mockReset().mockResolvedValue({
    site,
    latestVersion: makeVersion(3),
  });
  apiMock.getVersions
    .mockReset()
    .mockResolvedValue({ versions: [makeVersion(3), makeVersion(2), makeVersion(1)] });
  apiMock.getLlmsTxt.mockReset().mockResolvedValue(CONTENT);
  apiMock.getPages.mockReset().mockResolvedValue({
    pages: [
      {
        url: "https://acme.dev/docs/quickstart",
        title: "Quickstart",
        description: null,
        sectionHint: "Docs",
        status: "ok",
      },
    ],
  });
});

it("renders the file, version history, and hosted URL", async () => {
  render(<ResultView siteId={site.id} />);

  expect(await screen.findByText("# Acme")).toBeInTheDocument();
  expect(screen.getByText(/\[Quickstart\]/)).toBeInTheDocument(); // highlighted link label
  expect(screen.getByText("v3")).toBeInTheDocument();
  expect(apiMock.getLlmsTxt).toHaveBeenCalledWith("https://acme.dev");
  expect(
    screen.getByRole("link", {
      name: "http://localhost:8787/sites/https%3A%2F%2Facme.dev/llms.txt",
    }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Download" })).toBeInTheDocument();
});

it("shows monitoring status without exposing a switch", async () => {
  render(<ResultView siteId={site.id} />);

  await screen.findByText("# Acme");

  expect(screen.getByText("modification window")).toBeInTheDocument();
  expect(screen.queryByRole("switch", { name: "Toggle monitoring" })).not.toBeInTheDocument();
  expect(screen.getByText(/monitoring paused\. window is every 6 hours\./i)).toBeInTheDocument();
});

it("shows the page inventory on the pages tab", async () => {
  render(<ResultView siteId={site.id} />);
  await screen.findByText("# Acme");

  fireEvent.click(screen.getByRole("button", { name: "pages" }));

  expect(await screen.findByText("/docs/quickstart")).toBeInTheDocument();
  expect(screen.getByText("ok")).toBeInTheDocument();
});
