import { expect, test } from "@playwright/test";
import { requireCredentials, signIn } from "./helpers";

// A phone: the measurements behind specs/005-phone-experience (SC-001..004).
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const PAGES = ["/jobs", "/email-updates", "/search", "/search?tab=scout", "/matches", "/settings"];

test.describe("Phone layout", () => {
  test.beforeEach(async ({ page }) => {
    requireCredentials();
    await signIn(page);
  });

  test("opens on My Jobs with a four-slot bottom bar", async ({ page }) => {
    await expect(page).toHaveURL(/\/jobs/);
    const bar = page.getByRole("navigation", { name: "Main" });
    await expect(bar.locator("a, button")).toHaveText(["My Jobs", /Email/, "Find Jobs", "More"]);
  });

  test("Email updates is one tap from anywhere", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Email/ }).click();
    await expect(page).toHaveURL(/\/email-updates/);
  });

  test("More holds the other pages and Sign out", async ({ page }) => {
    await page.getByRole("button", { name: "More", exact: true }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("link", { name: "Settings" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Sign out" })).toBeVisible();
    // Once it has slid up, the sheet sits at the bottom of the screen, inside it.
    await expect
      .poll(async () => {
        const box = (await sheet.boundingBox())!;
        return Math.round(box.y + box.height);
      })
      .toBeLessThanOrEqual(845);
  });

  test("no page scrolls sideways", async ({ page }) => {
    for (const path of PAGES) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const wide = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      expect(wide, `${path} is wider than the screen`).toBe(false);
    }
  });

  test("My Jobs shows jobs straight away, a page at a time", async ({ page }) => {
    await page.goto("/jobs");
    const rows = page.locator("main ul > li a[href^='/jobs/']");
    await expect(rows.first()).toBeVisible();
    // The first job starts within 200px of the top, and at most one page is drawn.
    expect((await rows.first().boundingBox())!.y).toBeLessThanOrEqual(200);
    expect(await rows.count()).toBeLessThanOrEqual(30);
  });

  test("buttons in the page are big enough for a thumb", async ({ page }) => {
    for (const path of ["/jobs", "/email-updates", "/search", "/settings"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const small = await page.evaluate(() =>
        // A switch keeps its small look; its tap area is padded out around it.
        [...document.querySelectorAll("main button:not([role=switch])")]
          .map((b) => b.getBoundingClientRect())
          .filter((r) => r.width > 0 && r.height < 44).length,
      );
      expect(small, `${path} has buttons under 44px tall`).toBe(0);
    }
  });
});
