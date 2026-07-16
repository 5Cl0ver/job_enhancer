import { expect, test } from "@playwright/test";

test.describe("Authentication", () => {
  test("unauthenticated visitor is redirected to /login", async ({ page }) => {
    await page.goto("/search");
    await expect(page).toHaveURL(/\/login/);
  });

  test("login page offers email/password and OAuth options", async ({
    page,
  }) => {
    await page.goto("/login");
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /continue with google/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /continue with github/i }),
    ).toBeVisible();
  });

  test("root path redirects into the app flow", async ({ page }) => {
    await page.goto("/");
    // Unauthenticated: /search gate bounces to /login
    await expect(page).toHaveURL(/\/(login|search)/);
  });
});
