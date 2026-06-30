/**
 * AI Customer Graph — Shared Constants
 */

/** Maximum iterations for ReAct agent loops */
export const MAX_ITERATIONS = 3;

/**
 * Maximum recent messages to include in LLM context per agent invocation.
 * Uses token-aware sliding window approach:
 * - System prompt + tool definitions ~3K tokens
 * - 20 messages ~5-10K tokens
 * - DeepSeek context window is 128K, so this is well within limits
 * Adjust based on actual token usage monitoring.
 */
export const MAX_CONTEXT_MESSAGES = 20;
