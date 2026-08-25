// Flat config (ESLint 9+/10). Replaces the old .eslintrc.cjs — migrated as
// part of clearing out deprecated npm dependency warnings: ESLint 8 itself
// was deprecated and dragged in several deprecated transitive deps
// (rimraf@3, @humanwhocodes/config-array, @humanwhocodes/object-schema) that
// no longer exist under ESLint 10. See README.md's npm-deprecation section
// for the full picture of what is and isn't fixable this way.
//
// One behavior change worth flagging: the old `eslint . --ext .ts,.tsx`
// command only ever looked at .ts/.tsx files -- flat config has no --ext
// equivalent, so `eslint .` now also lints the plain-Node .mjs scripts
// (build-preload.mjs, everything under test/). That's a real improvement
// (those files were never actually checked before), not a regression -- it
// did require adding real Node globals here so `process`/`console`/`Buffer`
// aren't flagged as undefined in them.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default [
  {
    ignores: ["dist", "dist-electron", "node_modules", "release", "vendor"],
  },
  js.configs.recommended,
  {
    // Applies repo-wide: renderer (browser) code, Electron main/preload
    // (node) code, and the plain-Node .mjs scripts/tests all get both sets
    // of globals, same as the old .eslintrc.cjs's merged
    // `env: { browser, node, es2021 }` did for whatever it linted.
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
      },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parser: tsParser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      // ESLint's own `no-unused-vars` conflicts with the TS-aware version
      // above (it doesn't understand type-only usage) — same as the old
      // .eslintrc.cjs implicitly got for free from "plugin:@typescript-eslint/recommended".
      "no-unused-vars": "off",
      // Same story for `no-undef` on .ts/.tsx: it's a plain-JS rule that
      // doesn't know about TS ambient global types (Electron's namespace
      // types, DOM lib types like MediaTrackConstraints, etc.) and flags
      // them as undefined — false positives the TS compiler itself already
      // catches correctly. typescript-eslint's own docs recommend turning
      // this off for TS files for exactly this reason.
      "no-undef": "off",
    },
  },
];
