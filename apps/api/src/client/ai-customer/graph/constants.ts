/**
 * AI Customer Graph — Shared Constants
 */

/**
 * Maximum iterations for ReAct agent loops.
 *
 * 3 轮对钱包流程不够：KYC + 余额 + 渠道 + flowData + applyWithdraw
 * 至少需要 4~5 轮；第 3 轮就停会让模型还没弹卡就被截断。
 * 6 轮仍能防止失控循环。
 */
export const MAX_ITERATIONS = 6;

/**
 * Maximum recent messages to include in LLM context per agent invocation.
 * Uses token-aware sliding window approach:
 * - System prompt + tool definitions ~3K tokens
 * - 20 messages ~5-10K tokens
 * - DeepSeek context window is 128K, so this is well within limits
 * Adjust based on actual token usage monitoring.
 */
export const MAX_CONTEXT_MESSAGES = 20;

/**
 * 发给模型的上下文 token 预算（按字符数近似，1 token ≈ 4 chars）。
 * 超过预算时按“消息组”从旧到新裁剪，工具调用与结果不可拆开。
 */
export const CONTEXT_TOKEN_BUDGET = 6_000;

/** 无论如何都保留的最近消息条数，避免预算估算偏低时把当前问题裁掉。 */
export const MIN_CONTEXT_MESSAGES = 6;
