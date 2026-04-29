// @ts-nocheck
// open-next.config.ts — used by @opennextjs/cloudflare build process
// See: https://opennext.js.org/cloudflare
//
// NOTE: This file is consumed by OpenNext esbuild, NOT by TypeScript tsc.
// It is excluded from tsconfig.json and .eslintignore to prevent
// WebStorm cascading errors and ESLint pre-push hook violations.

import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import kvIncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/kv-incremental-cache';
import kvTagCache from '@opennextjs/cloudflare/overrides/tag-cache/kv-next-tag-cache';

// Blog uses ISR / incremental caching with KV + R2.
// Using OpenNext's built-in KV incremental cache for persistent ISR.
export default defineCloudflareConfig({
  incrementalCache: kvIncrementalCache,
  tagCache: kvTagCache,
});
