// The side panel app (spec 015, Story 7): React 19 + Tailwind v4 with the web
// app's own colors and components, so Job Catcher looks like Job Enhancer.
// Built into dist/panel/ by `npm run build` (see ../build.mjs); the manifest's
// side_panel points at dist/panel/index.html.
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  // Extension pages load files relative to themselves.
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    outDir: fileURLToPath(new URL("../dist/panel", import.meta.url)),
    emptyOutDir: true,
    // One small page: no code splitting, no source maps in the shipped build.
    sourcemap: false,
    chunkSizeWarningLimit: 800,
  },
  logLevel: "warn",
});
