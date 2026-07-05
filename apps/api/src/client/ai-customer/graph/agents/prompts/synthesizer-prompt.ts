/**
 * Synthesizer Prompt — AI 客服的"多面手合成器"说明书
 *
 * ═══════════════════════════════════════════════════════════════
 * 📖 一句话解释
 * ═══════════════════════════════════════════════════════════════
 *
 * 用户问了一个问题，涉及到多个业务领域（比如同时问"商品价格 + 优惠券 + 余额"），
 * 系统会同时派几个 Agent 去查数据。这个文件就是把这些 Agent 的回答
 * "拼成一条完整的回复"给用户。
 *
 * 比如用户问："那个包多少钱？我有优惠券吗？我钱包够不够？"
 *   → productAgent 查到了包的价格
 *   → couponAgent 查到了优惠券
 *   → walletAgent 查到了余额
 *   → Synthesizer 把它们合并成一句："包只要 $29.99，你有 10% 优惠券，钱包有 $105，够买！"
 *
 *
 * ═══════════════════════════════════════════════════════════════
 * 🏗️ AI 客服的 3 层能力
 * ═══════════════════════════════════════════════════════════════
 *
 *   Layer 3: Synthesizer（合成器）← 这个文件
 *     ↑ 把多个业务专家的回答合并成一条回复，不查数据
 *
 *   Layer 2: Agent（业务专家，如 orderAgent、productAgent）
 *     ↑ 有真实接口可以调（查订单、查商品、查余额）
 *     ↑ 必须调接口拿数据，不能自己编
 *
 *   Layer 1: General Chat（闲聊）
 *     ↑ 没有接口，只能聊天
 *
 *
 * ═══════════════════════════════════════════════════════════════
 * 🎯 核心原则（最重要的规则）
 * ═══════════════════════════════════════════════════════════════
 *
 *   ✅ Agent 查到了真实数据 → 合并到回复里
 *   ❌ Agent 报错了 → 默默跳过，不要告诉用户"某系统报错"
 *   ❌ 绝对不能自己编造数据 → 合成器没有数据源
 *
 * 为什么不能编数据？
 *
 * 假设这个场景：
 *   productAgent 查到了 "包的价格是 $29.99"
 *   walletAgent 查到了 "余额是 $105"
 *   couponAgent 报错了（没查到优惠券）
 *
 * ❌ 不好的合成（自己编造）：
 *   "包 $29.99，钱包 $105，你还有一个 20% 优惠券"
 *    （优惠券是编的！因为 couponAgent 报错了！）
 *
 * ✅ 好的合成（跳过错误）：
 *   "包 $29.99，钱包 $105 够买了。优惠券暂时查不到，建议稍后再试。"
 *
 *
 * ═══════════════════════════════════════════════════════════════
 * 🔄 什么情况会走这里？
 * ═══════════════════════════════════════════════════════════════
 *
 * ✅ 会走 Synthesizer：
 *   - 用户一句话提到多个业务："这个包怎么样？能优惠吗？"
 *   - 多个 Agent 被触发，需要合并结果
 *   - 比如 product + coupon 同时被路由
 *
 * ❌ 不会走 Synthesizer：
 *   - 只命中一个 Agent → 直接返回 Agent 的回答
 *   - 纯闲聊 → 走 General Chat
 *   - 或者命中 Agent 但是只命中一个
 *
 *
 * ═══════════════════════════════════════════════════════════════
 * 📝 注意
 * ═══════════════════════════════════════════════════════════════
 *
 * 这个 prompt 本身不查数据，它只是"排版工"。
 * 所有数据都是 Agent 查好的，它只管格式化和合并。
 * 如果所有 Agent 都报错，它应该说"暂时查不到，请稍后再试"。
 */

import { ChatPromptTemplate } from '@langchain/core/prompts';

//
//  ── 以下内容会直接发给 LLM，告诉它如何合成多个 Agent 的结果 ──
//
export const SYNTHESIZER_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    `You are JoyMini, a friendly and professional e-commerce customer service AI assistant.

You have received results from MULTIPLE specialized assistants on the same customer inquiry.
Each result is prefixed with [agentName]:. Your job is to merge these results into a single,
coherent, friendly response that addresses ALL parts of the user's question.

Guidelines:
- Present information from ALL assistants in a natural, flowing response
- Use numbered lists or bullet points for clarity when showing multiple items
- Keep your tone warm and professional
- Keep responses concise but complete
- If an assistant returned an error or disclaimer, silently skip it

Results from assistants:
{agentOutput}

User's original question: {userInput}`,
  ],
  ['human', '{userInput}'],
]);
