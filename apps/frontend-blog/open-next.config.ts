// open-next.config.ts — used by @opennextjs/cloudflare build process
// See: https://opennext.js.org/cloudflare

// @ts-expect-error — ESM-only module in CommonJS context; consumed by esbuild at build time
import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// @ts-expect-error — ESM-only module in CommonJS context; consumed by esbuild at build time
import kvIncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/kv-incremental-cache';

// @ts-expect-error — ESM-only module in CommonJS context; consumed by esbuild at build time
import kvTagCache from '@opennextjs/cloudflare/overrides/tag-cache/kv-next-tag-cache';

// Blog uses ISR / incremental caching with KV + R2.
// Using OpenNext's built-in KV incremental cache for persistent ISR.
export default defineCloudflareConfig({
  incrementalCache: kvIncrementalCache,
  tagCache: kvTagCache,
});
