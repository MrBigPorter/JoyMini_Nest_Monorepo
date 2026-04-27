// open-next.config.ts — used by @opennextjs/cloudflare build process
// See: https://opennext.js.org/cloudflare
import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// Blog uses ISR / incremental caching with KV + R2.
// Using "dummy" keeps the Worker self-contained for now.
export default defineCloudflareConfig({
  incrementalCache: 'dummy',
  tagCache: 'dummy',
  queue: 'dummy',
});
