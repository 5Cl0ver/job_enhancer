// Bundles the scripts that need the shared extractor modules (src/extract/*)
// into plain IIFE files Chrome can load directly. Everything else in the
// extension (background.js, sidepanel.js/html, config.js, picker.js) is already
// plain and is loaded as-is.
//
//   npm run build      one-shot build → dist/
//   npm run dev        rebuild on change
import { build, context } from "esbuild";

const options = {
  entryPoints: {
    content: "src/content.entry.js", // injected content script (Save button)
    capture: "src/capture.entry.js", // injected on demand by "Capture this page"
    bridge: "src/bridge.entry.js", // MAIN-world: mirrors Indeed's page JSON to the DOM
    background: "src/background.entry.js", // service worker (API/auth/backfill)
  },
  bundle: true,
  format: "iife",
  target: "chrome110",
  outdir: "dist",
  logLevel: "info",
};

if (process.argv.includes("--watch")) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("esbuild: watching src/ …");
} else {
  await build(options);
}
