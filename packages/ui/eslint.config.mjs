import { config } from "@repo/eslint-config/react-internal";

/** @type {import("eslint").Linter.Config} */
export default [
  {
    ignores: ["scripts/", "dist/", "node_modules/", "*.config.js", "*.config.mjs"],
  },
  ...config,
];
