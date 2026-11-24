import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "dist-extension",
      "src-tauri",
      "node_modules",
      "coverage",
      "extension/vendor",
      // Task checkouts and local test vaults (T-283): each holds a whole copy of the app.
      ".worktrees",
      "test-vaults",
    ],
  },
  {
    // The browser extension: plain JavaScript modules.
    extends: [js.configs.recommended],
    files: ["extension/**/*.js", "scripts/**/*.mjs", "src/features/hub/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.webextensions, ...globals.node },
    },
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // Study blocks render note text; it must never become markup or code (T-267).
    files: ["src/features/studyBlocks/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[property.name=/^(innerHTML|outerHTML)$/]",
          message: "Study blocks build DOM from text only.",
        },
        {
          selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
          message: "Study blocks build DOM from text only.",
        },
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: "Study blocks build DOM from text only.",
        },
      ],
      "no-eval": "error",
      "no-new-func": "error",
    },
  },
);
