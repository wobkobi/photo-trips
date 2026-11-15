import js from "@eslint/js";
import prettier from "eslint-config-prettier/flat";
import jsdoc from "eslint-plugin-jsdoc";
import prettierPlugin from "eslint-plugin-prettier/recommended";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tailwindCanonical from "eslint-plugin-tailwind-canonical-classes";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Type-aware TS rules for app code. Scoped to src/ because scripts/ and the root configs sit
  // outside tsconfig's project graph, so they stay on the non-type-checked recommended set.
  ...tseslint.configs.recommendedTypeChecked.map((c) => ({
    ...c,
    files: ["src/**/*.{ts,tsx}"],
  })),
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Async handlers on JSX props (onClick={async ...}) are fine - React ignores the returned
      // promise. Keep the non-attribute checks on.
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },

  // React
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },

  // JSDoc baseline. TS files take their types from the code; the plain .mjs scripts have no
  // annotations, so their JSDoc keeps its {types}.
  { ...jsdoc.configs["flat/recommended-typescript-error"], files: ["**/*.{ts,tsx}"] },
  { ...jsdoc.configs["flat/recommended-typescript-flavor-error"], files: ["**/*.{js,mjs}"] },

  {
    files: ["**/*.{js,mjs,jsx,ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    settings: {
      jsdoc: { mode: "typescript" },
    },
    rules: {
      // Require === except the idiomatic `!= null` check
      eqeqeq: ["error", "smart"],

      "@typescript-eslint/no-unused-vars": "error",
      "@typescript-eslint/consistent-type-definitions": "error",

      "jsdoc/require-jsdoc": [
        "error",
        {
          require: {
            FunctionDeclaration: true,
            FunctionExpression: true,
            ArrowFunctionExpression: true,
            MethodDefinition: true,
          },
        },
      ],
      "jsdoc/require-param": "error",
      "jsdoc/require-returns": "error",
      "jsdoc/check-param-names": "error",
      "jsdoc/check-tag-names": "error",
      "jsdoc/no-undefined-types": "error",
      "jsdoc/require-param-type": "off",
      "jsdoc/require-returns-type": "off",
      "jsdoc/require-param-description": "error",
      "jsdoc/require-returns-description": "error",
      "jsdoc/require-description": "error",
    },
  },

  // Plain JS can't annotate return types, so this only applies to TS
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/explicit-function-return-type": ["warn", { allowExpressions: true }],
    },
  },

  // Tailwind class hygiene. Prettier (via prettier-plugin-tailwindcss) only sorts classes; this
  // rule collapses arbitrary values that have a scale equivalent (max-w-[12rem] > max-w-48) via
  // Tailwind v4's own canonicalizeCandidates API, reading the theme from the CSS entry.
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "tailwind-canonical-classes": tailwindCanonical },
    rules: {
      "tailwind-canonical-classes/tailwind-canonical-classes": [
        "warn",
        { cssPath: "src/index.css" },
      ],
    },
  },

  // Turn off stylistic rules that clash with Prettier, then report formatting through ESLint
  prettier,
  prettierPlugin,

  globalIgnores([
    "dist/**",
    "src-tauri/**",
    "node_modules/**",
    "coverage/**",
    ".eslintcache",
    "eslint.config.js",
    "prettier.config.ts",
    "vite.config.ts",
  ]),
]);
