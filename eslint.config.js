import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: [".agents/skills/**", "dist/**", "coverage/**", "node_modules/**", "web/**", "storybook-static/**", "**/fixtures/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { console: "readonly", process: "readonly", URL: "readonly", fetch: "readonly", Buffer: "readonly", Headers: "readonly", Request: "readonly", Response: "readonly" } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }]
    }
  },
  {
    files: ["storybook/*.stories.js"],
    languageOptions: { globals: { document: "readonly", DOMParser: "readonly", ResizeObserver: "readonly" } }
  }
);
