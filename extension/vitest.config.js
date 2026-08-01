import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node", // each test builds its own happy-dom Document from a fixture
    include: ["test/**/*.spec.js"],
  },
});
