import { defineConfig, devices } from "@playwright/test";

/**
 * E2E tests run against a locally running stack:
 *   1. backend:  uvicorn app.main:app --reload   (backend/, with .env)
 *   2. frontend: npm run dev                     (frontend/, with .env.local)
 *
 * Specs that need a signed-in user are skipped unless E2E_EMAIL and
 * E2E_PASSWORD are set (a confirmed Supabase email/password account).
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
