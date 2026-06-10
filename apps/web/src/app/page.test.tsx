import { render, screen } from "@testing-library/react";
import Home from "./page";

it("renders the project name", () => {
  render(<Home />);
  expect(screen.getByRole("heading", { name: "profound-takehome" })).toBeInTheDocument();
});
