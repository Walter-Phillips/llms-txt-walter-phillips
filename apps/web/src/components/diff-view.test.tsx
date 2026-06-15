import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { DiffView } from "./diff-view";

const DIFF = [
  "--- llms.txt v1",
  "+++ llms.txt v2",
  "@@ -1,4 +1,4 @@",
  " # Acme",
  "-- [Old page](https://acme.dev/old)",
  "+- [New page](https://acme.dev/new)",
  " ## Docs",
].join("\n");

it("colors added, removed, hunk, and context lines distinctly", () => {
  render(<DiffView diff={DIFF} />);
  const view = screen.getByTestId("diff-view");
  const kinds = Array.from(view.querySelectorAll("[data-diff-line]")).map((element) =>
    element.getAttribute("data-diff-line"),
  );
  expect(kinds).toEqual(["meta", "meta", "hunk", "ctx", "del", "add", "ctx"]);

  const added = view.querySelector('[data-diff-line="add"]');
  const removed = view.querySelector('[data-diff-line="del"]');
  expect(added).toHaveTextContent("New page");
  expect(removed).toHaveTextContent("Old page");
  expect(added?.className).toContain("text-moss");
  expect(removed?.className).toContain("text-accent");
});
