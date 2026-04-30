#!/usr/bin/env node
/**
 * Post-build script: patches .open-next/worker.js to add a queue() handler.
 *
 * Cloudflare requires a queue() handler export when queues.consumers is declared
 * in wrangler.jsonc. OpenNext's generated worker.js only exports DOQueueHandler
 * (the Durable Object class) but does NOT include a top-level queue() handler.
 *
 * This script injects a queue() handler into the default export that forwards
 * messages from the Cloudflare Queue to the DOQueueHandler Durable Object.
 *
 * Usage:
 *   node scripts/patch-worker-queue.mjs
 *
 * Run AFTER `yarn exec opennextjs-cloudflare build` but BEFORE
 * `yarn exec opennextjs-cloudflare deploy`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = resolve(__dirname, '..', '.open-next', 'worker.js');

/**
 * The queue handler to inject into the default export.
 *
 * When the Cloudflare Queue consumer receives messages (from the
 * "next-revalidation-queue"), this handler forwards each message to the
 * DOQueueHandler Durable Object via env.NEXT_CACHE_DO_QUEUE.
 *
 * NOTE: With queue: "durable-queue" in open-next.config.ts, OpenNext sends
 * revalidation messages directly to the DO (bypassing the Cloudflare Queue).
 * This handler exists to satisfy Cloudflare's deployment validation that a
 * queue() handler is present when queues.consumers is declared.
 */
const QUEUE_HANDLER_CODE = `
    // Queue consumer for next-revalidation-queue
    // Forwards messages to DOQueueHandler Durable Object
    async queue(batch, env, ctx) {
        for (const message of batch.messages) {
            const msg = message.body;
            const groupId = msg.MessageGroupId || 'default';
            const id = env.NEXT_CACHE_DO_QUEUE.idFromName(groupId);
            const stub = env.NEXT_CACHE_DO_QUEUE.get(id);
            ctx.waitUntil(stub.revalidate(msg).catch((err) => {
                console.error('[QueueHandler] revalidation failed:', err);
            }));
        }
    },
`;

try {
    let content = readFileSync(WORKER_PATH, 'utf-8');

    // Check if queue handler already exists
    if (content.includes('async queue(batch, env, ctx)')) {
        console.log('[patch-worker-queue] queue() handler already present, skipping.');
        process.exit(0);
    }

    // Check if the default export object exists
    if (!content.includes('export default {')) {
        console.error('[patch-worker-queue] Could not find "export default {" in worker.js');
        process.exit(1);
    }

    // Insert queue handler after "export default {" and before the first property
    // We look for the pattern: export default {\n    async fetch
    // And insert the queue handler between the opening brace and async fetch
    const patched = content.replace(
        /export default \{\n\s+async fetch/,
        `export default {${QUEUE_HANDLER_CODE}\n    async fetch`
    );

    if (patched === content) {
        console.error('[patch-worker-queue] Failed to inject queue handler - pattern not matched.');
        process.exit(1);
    }

    writeFileSync(WORKER_PATH, patched, 'utf-8');
    console.log('[patch-worker-queue] Successfully injected queue() handler into worker.js');
} catch (err) {
    console.error('[patch-worker-queue] Error:', err.message);
    process.exit(1);
}
