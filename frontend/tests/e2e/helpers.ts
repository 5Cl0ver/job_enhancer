import { expect, type Page, test } from "@playwright/test";

export const E2E_EMAIL = process.env.E2E_EMAIL;
export const E2E_PASSWORD = process.env.E2E_PASSWORD;

/** Skip the current suite unless E2E credentials are configured. */
export function requireCredentials() {
  test.skip(
    !E2E_EMAIL || !E2E_PASSWORD,
    "Set E2E_EMAIL and E2E_PASSWORD (confirmed Supabase account) to run signed-in E2E tests",
  );
}

export async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(E2E_EMAIL!);
  await page.getByLabel("Password").fill(E2E_PASSWORD!);
  await page.getByRole("button", { name: /sign in with email/i }).click();
  await expect(page).toHaveURL(/\/search/, { timeout: 15_000 });
}
