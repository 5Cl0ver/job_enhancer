import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

// Vite config for the Job Enhancer SPA.
// - react(): JSX + Fast Refresh (hot reload)
// - tsconfigPaths(): makes the "@/*" import alias from tsconfig.json work
// Tailwind v4 is applied automatically via postcss.config.mjs.
// - __APP_VERSION__: the deployed commit (Vercel sets VERCEL_GIT_COMMIT_SHA),
//   7 characters, or "dev" locally. Bug reports carry it (spec 032).
const appVersion =
  (process.env.VERCEL_GIT_COMMIT_SHA ?? "").trim().slice(0, 7) || "dev";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  server: {
    port: 5173,
    open: true, // open the browser automatically on `npm run dev`
  },
});
