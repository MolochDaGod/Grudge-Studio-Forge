// Minimal ESLint flat config for the api-server.
//
// Why scoped to `src/`?
// Server logs go through pino via `req.log` (route handlers) or the singleton
// `logger` (non-request code). Stray `console.*` calls bypass structured
// logging, get picked up as plain stdout in production, and clutter the
// shared log stream. This rule keeps the source tree honest; the build
// output and tests are intentionally not linted.
//
// Run: `pnpm --filter @workspace/api-server run lint`
import tsParser from "@typescript-eslint/parser";

export default [
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
    },
    rules: {
      "no-console": "error",
    },
  },
];
