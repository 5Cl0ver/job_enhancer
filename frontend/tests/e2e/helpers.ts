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
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // A computer opens on Find Jobs, a phone on My Jobs.
  await expect(page).toHaveURL(/\/(search|jobs)/, { timeout: 15_000 });
}
