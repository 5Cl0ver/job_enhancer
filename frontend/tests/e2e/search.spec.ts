import { expect, test } from "@playwright/test";
import { requireCredentials, signIn } from "./helpers";

test.describe("Job search", () => {
  test.beforeEach(async ({ page }) => {
    requireCredentials();
    await signIn(page);
  });

  test("searching shows results with filters", async ({ page }) => {
    await page.getByPlaceholder(/job title/i).fill("Python Developer");
    await page.getByRole("button", { name: /search/i }).click();

    await expect(page.getByText(/result/i).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByLabel("Experience level")).toBeVisible();
    await expect(page.getByLabel("Maximum salary")).toBeVisible();
  });

  test("a search can be saved for the New Matches feed", async ({ page }) => {
    await page.getByPlaceholder(/job title/i).fill("React Engineer");
    await page.getByRole("button", { name: /search/i }).click();

    const saveButton = page.getByRole("button", {
      name: /save this search|search saved/i,
    });
    await expect(saveButton).toBeVisible();
  });
});
