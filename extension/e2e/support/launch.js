// Load a TEST COPY of the built extension into real Chromium.
//
// The repo's extension/config.js always points at the live app (and must stay
// that way), so the tests never load the repo folder itself: they copy the
// built extension to a temp folder, write a config.js there that points at the
// fake server, and let the autofill script also run on the lab's http pages.
// Nothing in the repo is changed.
import { chromium } from "@playwright/test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url)))); // extension/
export const FIXTURES = join(ROOT, "test", "fixtures");

const SKIP = new Set(["node_modules", "e2e", "test", "test-results", "src", ".vite"]);

/** The lab's pages are served over http on these hosts (two origins). */
const LAB_MATCHES = ["http://localhost/*", "http://127.0.0.1/*"];

function makeCopy(apiUrl) {
  const dir = mkdtempSync(join(tmpdir(), "je-ext-"));
  cpSync(ROOT, dir, {
    recursive: true,
    filter: (src) => src === ROOT || !SKIP.has(basename(src)),
  });
  writeFileSync(
    join(dir, "config.js"),
    "self.JOB_ENHANCER_CONFIG = " +
      JSON.stringify({
        API_BASE: apiUrl,
        APP_URL: apiUrl,
        SUPABASE_URL: apiUrl,
        SUPABASE_ANON_KEY: "test-anon-key",
      }) +
      ";\n",
  );
  const manifestPath = join(dir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const cs of manifest.content_scripts || []) {
    if (cs.js.some((f) => /autofill/.test(f))) cs.matches = [...cs.matches, ...LAB_MATCHES];
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return dir;
}

/**
 * @param {{apiUrl: string, signedIn?: boolean}} opts
 * @returns {Promise<{context, worker, extensionId, dir, seedSignedIn, reload, close}>}
 */
export async function launchExtension({ apiUrl, signedIn = true }) {
  const dir = makeCopy(apiUrl);
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
  });
  let worker = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(worker.url()).host;

  const ext = {
    context,
    dir,
    extensionId,
    get worker() {
      return worker;
    },
    /** A valid (fake) session, as if the user had signed in. */
    async seedSignedIn() {
      await worker.evaluate(
        (email) =>
          chrome.storage.local.set({
            je_token: "test-token",
            je_expires: Math.floor(Date.now() / 1000) + 3600,
            je_refresh: "test-refresh",
            je_email: email,
          }),
        "wren@example.com",
      );
    },
    /**
     * Reload the extension the way an update does: the reload button on
     * chrome://extensions. (chrome.runtime.reload() switches an extension
     * loaded this way OFF instead.) Open tabs keep their old, now-orphaned
     * content scripts.
     */
    async reload() {
      const next = context.waitForEvent("serviceworker", {
        predicate: (w) => w.url().startsWith(`chrome-extension://${extensionId}/`),
      });
      const mgr = await context.newPage();
      await mgr.goto("chrome://extensions/");
      const dev = mgr.locator("#devMode");
      if ((await dev.getAttribute("aria-pressed")) !== "true") await dev.click();
      await mgr.locator(`#${extensionId} #dev-reload-button`).click();
      worker = await next;
      await mgr.close();
      return worker;
    },
    async close() {
      await context.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
  if (signedIn) await ext.seedSignedIn();
  return ext;
}
