import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import Home from "./page";
import type * as ApiModule from "@/lib/api";

const { pushMock, createSiteMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  createSiteMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const apiModule = await importOriginal<typeof ApiModule>();
  return { ...apiModule, api: { ...apiModule.api, createSite: createSiteMock } };
});

beforeEach(() => {
  pushMock.mockReset();
  createSiteMock.mockReset();
});

function submitUrl(value: string) {
  fireEvent.change(screen.getByLabelText("Website URL"), { target: { value } });
  const form = screen.getByLabelText("Website URL").closest("form");
  if (form === null) {
    throw new Error("Expected Website URL input to be inside a form.");
  }
  fireEvent.submit(form);
}

it("renders the hero, explainer, and example chips", () => {
  render(<Home />);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/make your website legible/i);
  expect(screen.getByText(/the file LLMs read to understand your site/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "vercel.com" })).toBeInTheDocument();
  expect(screen.getByLabelText("Website URL")).toBeInTheDocument();
});

it("submits a URL and routes to the progress view", async () => {
  createSiteMock.mockResolvedValue({ siteId: "site_acme-dev", runId: "run_acme-dev_1" });
  render(<Home />);

  submitUrl("acme.dev");

  await waitFor(() => {
    expect(createSiteMock).toHaveBeenCalledWith("https://acme.dev");
    expect(pushMock).toHaveBeenCalledWith("/sites/site_acme-dev?run=run_acme-dev_1");
  });
});

it("shows a friendly error when the URL is rejected", async () => {
  const { ApiRequestError } = await import("@/lib/api");
  createSiteMock.mockRejectedValue(new ApiRequestError(400, "invalid_url: bad"));
  render(<Home />);

  submitUrl("not a url");

  expect(await screen.findByRole("alert")).toHaveTextContent(/enter a full website address/i);
  expect(pushMock).not.toHaveBeenCalled();
});

it("submitting an example chip kicks off a run", async () => {
  createSiteMock.mockResolvedValue({ siteId: "site_vercel-com", runId: "run_vercel-com_1" });
  render(<Home />);

  fireEvent.click(screen.getByRole("button", { name: "vercel.com" }));

  await waitFor(() => {
    expect(createSiteMock).toHaveBeenCalledWith("https://vercel.com");
    expect(pushMock).toHaveBeenCalledWith("/sites/site_vercel-com?run=run_vercel-com_1");
  });
});
