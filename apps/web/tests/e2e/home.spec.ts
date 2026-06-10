import { expect, test } from "@playwright/test";

test("loads the landing page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("plain text");
  await expect(page.getByLabel("Website URL")).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate" })).toBeVisible();
});
