import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/components/**/*.test.tsx"],
    css: false,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
