// open-next.config.ts — used by @opennextjs/cloudflare build process
// See: https://opennext.js.org/cloudflare
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import kvIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/kv-incremental-cache";
import kvTagCache from "@opennextjs/cloudflare/overrides/tag-cache/kv-next-tag-cache";

// Blog uses ISR / incremental caching with KV + R2.
// Using OpenNext's built-in KV incremental cache for persistent ISR.
export default defineCloudflareConfig({
  incrementalCache: kvIncrementalCache,
  tagCache: kvTagCache,
  queue: "dummy",
});
