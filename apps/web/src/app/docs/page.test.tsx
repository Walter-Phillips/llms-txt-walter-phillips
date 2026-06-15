import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import DocumentationPage from "./page";

it("documents product usage and implementation details", () => {
  render(<DocumentationPage />);

  expect(
    screen.getByRole("heading", {
      level: 1,
      name: /generate a durable map of your site for language models/i,
    }),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Use it" })).toHaveAttribute("href", "#use");
  expect(
    screen.getByRole("heading", { level: 2, name: /from url to hosted llms\.txt/i }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { level: 2, name: /the publishing pipeline/i }),
  ).toBeInTheDocument();
  expect(screen.getByText(/Durable Object owns live crawl state/i)).toBeInTheDocument();
  expect(screen.getByText(/generator cannot invent URLs/i)).toBeInTheDocument();
});
