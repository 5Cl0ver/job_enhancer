// Builds everything Chrome loads into dist/:
//   • content scripts + the background worker: esbuild, plain IIFE files
//   • the side panel (panel/): Vite + React + Tailwind → dist/panel/
//
//   npm run build      one-shot build → dist/
//   npm run dev        rebuild on change
import { build, context } from "esbuild";
import { fileURLToPath } from "node:url";
import { build as viteBuild } from "vite";

const options = {
  entryPoints: {
    content: "src/content.entry.js", // injected content script (Save button)
    bridge: "src/bridge.entry.js", // MAIN-world: mirrors Indeed's page JSON to the DOM
    background: "src/background.entry.js", // service worker (API/auth/backfill)
    autofill: "src/autofill.entry.js", // ATS application pages (Greenhouse/Lever)
    scoutpage: "src/scoutpage.entry.js", // Claude Scout page copies on companies' own sites
  },
  bundle: true,
  format: "iife",
  target: "chrome110",
  outdir: "dist",
  logLevel: "info",
};

const panel = { configFile: fileURLToPath(new URL("./panel/vite.config.ts", import.meta.url)) };

if (process.argv.includes("--watch")) {
  const ctx = await context(options);
  await ctx.watch();
  await viteBuild({ ...panel, build: { watch: {} } });
  console.log("watching src/ and panel/ …");
} else {
  await build(options);
  await viteBuild(panel);
}
