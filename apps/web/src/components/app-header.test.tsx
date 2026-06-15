import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { AppHeader } from "./app-header";

const { usePathnameMock } = vi.hoisted(() => ({
  usePathnameMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: usePathnameMock,
}));

beforeEach(() => {
  usePathnameMock.mockReturnValue("/");
});

it("links to product docs from the persistent header", () => {
  render(<AppHeader />);

  expect(screen.getByRole("link", { name: "docs" })).toHaveAttribute("href", "/docs");
  expect(screen.getByRole("link", { name: /spec/i })).toHaveAttribute(
    "href",
    "https://llmstxt.org",
  );
});

it("shows hosted status only on site result routes", () => {
  usePathnameMock.mockReturnValue("/sites/site_acme");

  render(<AppHeader />);

  expect(screen.getByText("hosted")).toBeInTheDocument();
});
