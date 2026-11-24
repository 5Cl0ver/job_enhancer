// Load a TEST COPY of the built extension into real Chromium.
//
// The repo's extension/config.js always points at the live app (and must stay
// that way), so the tests never load the repo folder itself: they copy the
// built extension to a temp folder, write a config.js there that points at the
// fake server, and let the autofill script also run on the lab's http pages.
// Nothing in the repo is changed.
import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url)))); // extension/
export const FIXTURES = join(ROOT, "test", "fixtures");

const SKIP = new Set(["node_modules", "e2e", "test", "test-results", "src", ".vite", ".legacy"]);

/** The lab's pages are served over http on these hosts (two origins). */
const LAB_MATCHES = ["http://localhost/*", "http://127.0.0.1/*"];

/**
 * Build the extension as it was at an older commit (e.g. the version users
 * have installed today), once, into extension/.legacy/<ref>/. Returns the
 * folder holding its manifest.json and dist/ — for real upgrade tests.
 */
export function buildLegacy(ref) {
  const base = join(ROOT, ".legacy", ref);
  const ext = join(base, "extension");
  if (existsSync(join(ext, "dist", "content.js"))) return ext;
  rmSync(base, { recursive: true, force: true });
  mkdirSync(base, { recursive: true });
  const repo = dirname(ROOT);
  const git = (args) => execSync(`git ${args}`, { cwd: repo, maxBuffer: 64 * 1024 * 1024 });
  const files = git(`ls-tree -r --name-only ${ref} -- extension/src extension/build.mjs extension/manifest.json extension/sidepanel.html extension/sidepanel.js`)
    .toString()
    .split(/\r?\n/)
    .filter(Boolean);
  for (const f of files) {
    const out = join(base, f);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, git(`show ${ref}:${f}`));
  }
  // esbuild resolves from extension/node_modules (a parent of this folder).
  execSync("node build.mjs", { cwd: ext, stdio: "pipe" });
  return ext;
}

/** Put a build's manifest.json + dist/ into the test copy (test matches added). */
function installBuild(dir, from) {
  rmSync(join(dir, "dist"), { recursive: true, force: true });
  cpSync(join(from, "dist"), join(dir, "dist"), { recursive: true });
  // Root files an old build's manifest points at (its side panel); a newer
  // build simply doesn't use them.
  for (const f of ["sidepanel.html", "sidepanel.js"]) {
    if (existsSync(join(from, f))) cpSync(join(from, f), join(dir, f));
  }
  const manifest = JSON.parse(readFileSync(join(from, "manifest.json"), "utf8"));
  for (const cs of manifest.content_scripts || []) {
    if (cs.js.some((f) => /autofill/.test(f))) cs.matches = [...cs.matches, ...LAB_MATCHES];
  }
  // The fake server stands in for the app: its /connect page may ask for the
  // Connect proof (the live build lists only the real app's address).
  if (manifest.externally_connectable) {
    manifest.externally_connectable.matches = [...manifest.externally_connectable.matches, "http://127.0.0.1/*"];
  }
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
}

function makeCopy(apiUrl, from = ROOT) {
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
  installBuild(dir, from);
  return dir;
}

/**
 * @param {{apiUrl: string, signedIn?: boolean, from?: string}} opts
 *   `from`: a folder with an older build (see buildLegacy) to start on.
 * @returns {Promise<{context, worker, extensionId, dir, seedSignedIn, reload, upgrade, close}>}
 */
export async function launchExtension({ apiUrl, signedIn = true, from = ROOT }) {
  const dir = makeCopy(apiUrl, from);
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
  });
  let worker = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(worker.url()).host;
  let remote = null; // an extension page that talks to the background for the tests

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
    /** Update to the current build, the way a user does: new files, then reload. */
    async upgrade() {
      // A build from before the pinned "key" (0.35.0) has another id; adding
      // the key would make the reload a different extension (people re-add it
      // once). These tests check what an update does to open tabs, so the
      // updated copy keeps the id it started with.
      const hadKey = !!JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")).key;
      installBuild(dir, ROOT);
      if (!hadKey) {
        const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
        delete manifest.key;
        writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
      }
      return ext.reload();
    },
    /** Send the background a message the way the side panel does (from an extension page). */
    async bg(msg) {
      if (!remote || remote.isClosed()) {
        remote = await context.newPage();
        await remote.goto(`chrome-extension://${extensionId}/dist/panel/index.html`);
      }
      return remote.evaluate((m) => chrome.runtime.sendMessage(m), msg);
    },
    async tabIdOf(page) {
      // Two tabs on one address: the newest (the page a test just opened).
      return worker.evaluate(
        async (u) => (await chrome.tabs.query({})).filter((t) => t.url === u).sort((a, b) => b.id - a.id)[0]?.id ?? null,
        page.url(),
      );
    },
    /** What the panel knows about a tab: does it have a form, and the status line's state. */
    async fillState(page) {
      const tabId = await ext.tabIdOf(page);
      return tabId == null ? null : (await ext.bg({ type: "getFillSession", tabId }))?.presence || null;
    },
    /**
     * Press Autofill as the panel's button does, once the page has reported a
     * form (as a person would see "Form found"). Resolves when the press is done.
     * @returns {Promise<{ok: boolean, filled: number, need: number, problem?: string, ms: number}>}
     */
    async autofill(page, { waitForForm = true } = {}) {
      const tabId = await ext.tabIdOf(page);
      if (waitForForm) {
        const until = Date.now() + 10_000;
        while (!(await ext.fillState(page))?.form) {
          if (Date.now() > until) throw new Error(`no form reported on ${page.url()}`);
          await new Promise((r) => setTimeout(r, 150));
        }
      }
      const t0 = Date.now();
      const res = await ext.bg({ type: "pressAutofill", tabId });
      return { ...res, ms: Date.now() - t0 };
    },
    async close() {
      await context.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
  if (signedIn) await ext.seedSignedIn();
  return ext;
}
