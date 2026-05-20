/**
 * Batch Processor — chunked sequential processing for Cloudflare Free tier.
 *
 * Cloudflare Workers Free plan has a 10ms CPU time limit per request.
 * Sending a large array of IDs in a single API call (e.g., 50+ article IDs
 * for batch translation) can exceed this limit, causing 504/524 gateway
 * timeouts.
 *
 * This utility splits items into small chunks and processes them sequentially
 * with a delay between chunks, keeping each API call well within the 10ms
 * CPU budget.
 *
 * Usage:
 *   const result = await processChunkedBatch(
 *     (chunk) => blogApi.translation.clearArticleTranslations(chunk, lang),
 *     { items: articleIds, chunkSize: 5, delayMs: 500 },
 *   );
 *   // result = { succeeded: 10, failed: 1, total: 11 }
 */

export interface ChunkedBatchResult {
  succeeded: number;
  failed: number;
  total: number;
}

export interface ChunkedBatchOptions<T> {
  /** Array of items to process in chunks */
  items: T[];
  /** Number of items per chunk (default: 5) */
  chunkSize?: number;
  /** Delay between chunks in ms (default: 500) */
  delayMs?: number;
}

/**
 * Process items in chunks sequentially with a delay between chunks.
 * Each chunk is sent as a separate API call to avoid hitting Cloudflare
 * Workers' 10ms CPU limit.
 */
export async function processChunkedBatch<T>(
  processor: (chunk: T[]) => Promise<unknown>,
  options: ChunkedBatchOptions<T>,
): Promise<ChunkedBatchResult> {
  const { items, chunkSize = 5, delayMs = 500 } = options;
  const chunks: T[][] = [];

  // Split items into chunks
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }

  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    try {
      await processor(chunk);
      succeeded += chunk.length;
    } catch (error) {
      console.error(
        `[BatchProcessor] Chunk ${i + 1}/${chunks.length} failed:`,
        error,
      );
      failed += chunk.length;
    }

    // Delay between chunks to avoid overwhelming the server
    if (i < chunks.length - 1 && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  return { succeeded, failed, total: items.length };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
