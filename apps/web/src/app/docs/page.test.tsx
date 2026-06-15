import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import DocumentationPage from "./page";

it("documents developer usage and product features", () => {
  render(<DocumentationPage />);

  expect(
    screen.getByRole("heading", {
      level: 1,
      name: /generate and publish llms\.txt for a site/i,
    }),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "What it is" })).toHaveAttribute("href", "#what");
  expect(screen.getByRole("link", { name: "Connect domain" })).toHaveAttribute("href", "#connect");
  expect(
    screen.getByRole("heading", { level: 2, name: /what an llms\.txt file does/i }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { level: 2, name: /generate a file for any public site/i }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("heading", {
      level: 2,
      name: /proxy \/llms\.txt from infrastructure you control/i,
    }),
  ).toBeInTheDocument();
  expect(screen.getByText(/app\/llms\.txt\/route\.ts/i)).toBeInTheDocument();
  expect(screen.getByText(/netlify\.toml/i)).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 3, name: /stable hosted URL/i })).toBeInTheDocument();
  expect(screen.getByText(/monitoring starts on by default/i)).toBeInTheDocument();
  expect(screen.getByText(/curl "https:\/\/our-api\.example\.com/i)).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Copy code" }).length).toBeGreaterThan(5);
});
