import { defineConfig } from "@playwright/test";

// MV3 extensions require a persistent context launched headed (or under xvfb in
// CI). Each test file drives that itself, so there's no global `use` browser.
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list", // plain text so the output is readable in a terminal / by CI
});
