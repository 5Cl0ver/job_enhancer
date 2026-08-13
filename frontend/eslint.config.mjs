import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

// Flat ESLint config for the Vite + React + TypeScript app.
export default tseslint.config(
  // Generated + build output isn't ours to lint.
  { ignores: ["dist", "src/types/api.gen.d.ts"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // A Vite HMR-only hint; off because shadcn/ui primitives intentionally
      // co-export `cva` variants alongside their component.
      "react-refresh/only-export-components": "off",
      // We use `any` deliberately in a few generic boundaries (e.g. third-party
      // OAuth payloads); flag unused code instead, which is what actually rots.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
