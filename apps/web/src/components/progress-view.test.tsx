import type { JobStatusResponse, Run } from "@profound-takehome/shared";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ProgressView } from "./progress-view";
import type * as ApiModule from "@/lib/api";

const { getJobMock } = vi.hoisted(() => ({ getJobMock: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => {
  const apiModule = await importOriginal<typeof ApiModule>();
  return { ...apiModule, api: { ...apiModule.api, getJob: getJobMock } };
});

function makeRun(overrides: Partial<Run>): Run {
  return {
    id: "run_1",
    siteId: "site_1",
    trigger: "manual",
    status: "queued",
    pagesFound: 0,
    pagesCrawled: 0,
    pagesChanged: 0,
    discoveryMethod: null,
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
    ...overrides,
  };
}

function crawlingStatus(): JobStatusResponse {
  return {
    run: makeRun({
      status: "crawling",
      pagesFound: 80,
      pagesCrawled: 23,
      discoveryMethod: "sitemap",
    }),
    live: {
      runId: "run_1",
      phase: "crawling",
      pagesFound: 80,
      pagesCrawled: 23,
      discoveryMethod: "sitemap",
      frontierSize: 57,
      inFlight: 4,
    },
  };
}

beforeEach(() => {
  getJobMock.mockReset();
});

it("shows crawl progress with page counts and discovery method", async () => {
  getJobMock.mockResolvedValue(crawlingStatus());
  render(<ProgressView runId="run_1" domain="acme.dev" onDone={vi.fn()} pollIntervalMs={5} />);

  // Crawl gauge: 23 of 80 pages.
  expect(await screen.findByText("23")).toBeInTheDocument();
  expect(screen.getByText("/ 80")).toBeInTheDocument();
  expect(screen.getByText("via sitemap")).toBeInTheDocument();
  expect(screen.getByText("Crawl")).toBeInTheDocument();
});

it("indicates link-crawl fallback when there is no sitemap", async () => {
  const status = crawlingStatus();
  status.run.discoveryMethod = "links";
  if (status.live === undefined) {
    throw new Error("Expected crawling status to include live progress.");
  }
  status.live.discoveryMethod = "links";
  getJobMock.mockResolvedValue(status);
  render(<ProgressView runId="run_1" onDone={vi.fn()} pollIntervalMs={5} />);

  expect(await screen.findByText("via links")).toBeInTheDocument();
});

it("advances through generating to done and notifies the caller", async () => {
  const onDone = vi.fn();
  getJobMock
    .mockResolvedValueOnce(crawlingStatus())
    .mockResolvedValueOnce({
      run: makeRun({
        status: "generating",
        pagesFound: 80,
        pagesCrawled: 80,
        discoveryMethod: "sitemap",
      }),
    })
    .mockResolvedValue({
      run: makeRun({
        status: "done",
        pagesFound: 80,
        pagesCrawled: 80,
        discoveryMethod: "sitemap",
        finishedAt: Date.now(),
      }),
    });

  render(<ProgressView runId="run_1" onDone={onDone} pollIntervalMs={5} />);

  await waitFor(() => {
    expect(onDone).toHaveBeenCalled();
  });
  expect(screen.getByText("Publish")).toBeInTheDocument();
});

it("renders a friendly, specific error state when the run fails", async () => {
  getJobMock.mockResolvedValue({
    run: makeRun({ status: "error", error: "fetch_failed: connection refused" }),
  });
  render(<ProgressView runId="run_1" onDone={vi.fn()} pollIntervalMs={5} />);

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(/couldn't reach that site/i);
  expect(screen.getByText("Try another URL")).toBeInTheDocument();
});
