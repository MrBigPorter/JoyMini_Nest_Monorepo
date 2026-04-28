import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// Admin blog does NOT need ISR / incremental caching.
// Using "dummy" implementations keeps the Worker self-contained:
// no R2 bucket, no KV namespace required.
export default defineCloudflareConfig({
  incrementalCache: 'dummy',
  tagCache: 'dummy',
  queue: 'dummy',
});
