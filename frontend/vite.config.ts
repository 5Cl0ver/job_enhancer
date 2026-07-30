import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

// Vite config for the Job Enhancer SPA.
// - react(): JSX + Fast Refresh (hot reload)
// - tsconfigPaths(): makes the "@/*" import alias from tsconfig.json work
// Tailwind v4 is applied automatically via postcss.config.mjs.
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  server: {
    port: 5173,
    open: true, // open the browser automatically on `npm run dev`
  },
});
