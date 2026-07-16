import { expect, test } from "@playwright/test";
import { requireCredentials, signIn } from "./helpers";

const DEFAULT_STAGES = [
  "Interested",
  "Referral Sent",
  "Applied",
  "Phone Screen",
  "Take-Home Assignment",
  "Interview",
  "Offer",
  "Rejected",
];

test.describe("Application tracker", () => {
  test.beforeEach(async ({ page }) => {
    requireCredentials();
    await signIn(page);
  });

  test("Kanban board shows the 8 default stages", async ({ page }) => {
    await page.goto("/tracker");
    for (const stage of DEFAULT_STAGES) {
      await expect(page.getByText(stage, { exact: true })).toBeVisible();
    }
  });

  test("saved jobs page offers manual add-job", async ({ page }) => {
    await page.goto("/saved");
    await page.getByRole("button", { name: /add job/i }).click();
    await expect(page.getByLabel("Job link")).toBeVisible();
    await expect(page.getByLabel("Job title")).toBeVisible();
  });
});
