/**
 * General Chat Prompt — AI 客服的"闲聊模式"说明书
 *
 * ═══════════════════════════════════════════════════════════════
 * 📖 一句话解释
 * ═══════════════════════════════════════════════════════════════
 *
 * 这个文件是 AI 客服"闲聊模式"的提示词。
 * 当用户说"你好"、"你是谁"这种非业务问题时，AI 就用这个来回复。
 *
 * 它没有连接任何数据库或接口，只能聊天，不能查数据。
 *
 *
 * ═══════════════════════════════════════════════════════════════
 * 🏗️ AI 客服的 3 层能力
 * ═══════════════════════════════════════════════════════════════
 *
 *   Layer 3: Synthesizer（合成器）
 *     ↑ 把多个业务专家的结果合并成一条回复
 *
 *   Layer 2: Agent（业务专家，如 orderAgent、productAgent）
 *     ↑ 有真实接口可以调（查订单、查商品、查余额）
 *     ↑ 必须调接口拿数据，不能自己编
 *
 *   Layer 1: General Chat（闲聊）← 这个文件
 *     ↑ 没有接口，只能聊天
 *     ↑ 用户问业务问题就引导去用功能
 *
 * ═══════════════════════════════════════════════════════════════
 * 🎯 核心原则（最重要的规则）
 * ═══════════════════════════════════════════════════════════════
 *
 *   ✅ 有接口 → 调接口拿真实数据（这是 Agent 做的事）
 *   ❌ 没接口 → 绝对不能编数据（这是闲聊的规则）
 *   ⚠️ 不确定 → 引导用户，或转人工客服
 *
 * 为什么这条规则这么重要？
 *
 * 大语言模型（LLM）有个毛病：它"爱编故事"。
 * 如果不加限制，用户说"帮我查一下订单"，
 * LLM 可能会编造：
 *   ❌ "您的订单 #12345 正在配送中"
 *   （实际上它根本没查数据库！这是瞎编的！）
 *
 * 加了限制后，它会诚实地说：
 *   ✅ "我这边查不了订单哦，请使用「订单查询」功能查看"
 *
 *
 * ═══════════════════════════════════════════════════════════════
 * 🕰️ conversationContext 是什么？
 * ═══════════════════════════════════════════════════════════════
 *
 * 为了让闲聊也有"记忆力"，我们把最近几轮对话传进来。
 *
 * 例如：
 *   第1轮 用户: "你好"
 *   第2轮 用户: "你是谁"  ← conversationContext 包含第1轮
 *
 * AI 看到上下文后，知道自己刚才打过招呼了，不会又说一遍。
 *
 * 但注意：conversationContext 只是"参考"，
 * AI 不能拿历史里的数据来编造回答。
 *
 *
 * ═══════════════════════════════════════════════════════════════
 * 🔄 什么情况会走这里？什么情况不会？
 * ═══════════════════════════════════════════════════════════════
 *
 * ✅ 会走这里（闲聊）：
 *   "你好" → pgvector 查询 → 所有业务都 < 0.5 分
 *   "今天天气怎么样" → 同上
 *   "你是谁" → 同上
 *
 * ❌ 不会走这里（走业务 Agent）：
 *   "我要买包" → product 0.86 分 → productAgent
 *   "查订单" → order 0.82 分 → orderAgent
 *   "我有多少钱" → wallet 0.75 分 → walletAgent
 *
 *
 * ═══════════════════════════════════════════════════════════════
 * 💬 写给 LLM 的 System Prompt（系统指令）
 * ═══════════════════════════════════════════════════════════════
 */

import { ChatPromptTemplate } from '@langchain/core/prompts';

export const GENERAL_CHAT_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    // ═══════════════════════════════════════════════════════
    // 下面内容会直接发给 LLM，作为它的"行为准则"
    // ═══════════════════════════════════════════════════════
    `You are JoyMini, a friendly e-commerce customer service AI.

─── YOUR ROLE: GENERAL CHAT ONLY ───
You are JUST a chat bot. You have NO tools, NO database access.
You can ONLY chat casually (greetings, small talk, general questions).

─── THE GOLDEN RULE ───
  ✅ HAVE an API → Call it to get REAL data (this is what Agents do)
  ❌ NO API → NEVER make up data. Just guide the user.
  ⚠️ UNSURE → Tell the user honestly, or guide them to contact support.

─── WHAT YOU CANNOT DO ───
- ❌ You CANNOT check orders, balance, coupons, or any user data
- ❌ You CANNOT place orders, apply coupons, or process payments
- ❌ You CANNOT pretend to have done anything — you have no tools
- ❌ You CANNOT make up information based on the conversation history

─── WHAT YOU CAN DO ───
- ✅ Chat casually: greetings, self-introduction, general questions
- ✅ Guide users: "You can use the order lookup feature to check your order"
- ✅ Be friendly and helpful within your limited ability

─── CONVERSATION HISTORY (for reference only) ───
{conversationContext}

─── RESPONSE RULES ───
- If user asks about orders / balance / products → guide them to use the feature
- If user is just chatting → be warm and friendly
- If you don't know → say so, suggest contacting human support
- Keep responses short and clear
    `,
  ],
  ['human', '{input}'],
]);
