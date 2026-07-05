/**
 * intent-prompt-builder — 意图分类的"备用大脑"说明书
 *
 * ═══════════════════════════════════════════════════════════════
 * 📖 一句话解释
 * ═══════════════════════════════════════════════════════════════
 *
 * 这个文件是"意图分类"的备用方案。
 * 正常情况下，系统用向量搜索（pgvector + Embedding）来判断用户想干什么。
 * 但当向量搜索不够确定时（所有业务得分 < 0.5），就调用 LLM 来帮忙判断。
 *
 * 比如用户只说"好的"、"继续"、"确认"这种短句，
 * 向量搜索很难判断，就需要 LLM 结合上下文来猜。
 *
 *
 * ═══════════════════════════════════════════════════════════════
 * 🧠 意图分类的两层策略
 * ═══════════════════════════════════════════════════════════════
 *
 *   Layer 1: Embedding（向量搜索）— 主力方案
 *     ↑ 把用户输入变成向量，和所有业务示例算相似度
 *     ↑ 速度快、稳定、不吃 LLM 额度
 *     ↑ 但如果用户只说一两个词，相似度就会很低
 *
 *   Layer 2: LLM Fallback（大语言模型）— 备用方案 ← 这个文件
 *     ↑ 当所有业务的相似度都 < 0.5 时启用
 *     ↑ 结合对话历史和之前分类结果来判断
 *     ↑ 专注处理"确认"、"继续"、"是的"这种短输入
 *
 *
 * ═══════════════════════════════════════════════════════════════
 * 🎯 什么时候走 LLM Fallback？
 * ═══════════════════════════════════════════════════════════════
 *
 *   ✅ 走 LLM Fallback：
 *     - 用户说"好的" → 所有业务 < 0.5 → 看 previousIntent 判断是哪个业务
 *     - 用户说"继续" → 同上
 *     - 用户说"是的" → 同上
 *     - 用户说"我现在在哪个步骤" → 看 flowState
 *     - Embedding 服务挂了 → 降级到 LLM
 *
 *   ❌ 不走 LLM Fallback（直接走 Embedding）：
 *     - 用户说"我要买包" → product 得分 0.86 → 直接路由
 *     - 用户说"查订单" → order 得分 0.82 → 直接路由
 *     - 用户说"提现 1000" → wallet 得分 0.75 → 直接路由
 *
 *
 * ═══════════════════════════════════════════════════════════════
 * 🎯 核心原则：必须输出 JSON
 * ═══════════════════════════════════════════════════════════════
 *
 * 这个 LLM 调用只做一件事：输出 JSON。
 * 格式必须是 { "intent": "xxx", "labels": [...] }
 *
 * 为什么必须 JSON？
 *   因为代码需要用 JSON.parse() 解析结果。
 *   如果 LLM 输出的是自然语言（"我觉得这个应该是订单"），
 *   程序就没法用，会报错。
 *
 *   所以规则写得很死：
 *   - 只能输出 JSON，不能有多余文字
 *   - 不能有 markdown，不能有反引号
 *   - 必须包含 intent 和 labels 字段
 *
 *
 * ═══════════════════════════════════════════════════════════════
 * 📝 previousIntent 的作用（多轮对话的关键）
 * ═══════════════════════════════════════════════════════════════
 *
 * 上一轮用户说"我要查订单"，分类为 order。
 * 这一轮用户说"好的"，没有上下文谁也不知道"好的"是什么意思。
 * 但有了 previousIntent = "order"：
 *   → LLM 知道用户刚才在查订单，说"好的"可能是确认查看订单
 *   → 给 order 打高分
 *
 * 但如果用户说"不要了，我想看看钱包"，
 *   → "不要了"加上"钱包" → 覆盖 previousIntent → 改成 wallet
 *
 *
 * ═══════════════════════════════════════════════════════════════
 * 📝 conversationContext 的作用
 * ═══════════════════════════════════════════════════════════════
 *
 * 不仅仅是 previousIntent，还有最近几轮的对话内容。
 * 让 LLM 能根据整段对话来理解用户意图。
 *
 *
 * ═══════════════════════════════════════════════════════════════
 * 📝 flowState 的作用
 * ═══════════════════════════════════════════════════════════════
 *
 * 如果用户正在一个多步骤流程中（比如提现：输金额 → 选渠道 → 输 OTP），
 * flowState 会记录当前走到哪一步了。
 * 用户说"好的"时，LLM 知道应该路由到 wallet（因为提现流程中）。
 */

// ============================================================
// Public API
// ============================================================

/**
 * 构建 LLM fallback 使用的 INTENT_PROMPT system prompt。
 *
 * 嵌入向量分类（IntentClassifier）先尝试，置信度不足时调用此 LLM fallback。
 * Fallback 场景：
 * 1. 用户输入过短（1-3 词），需要上下文判断
 * 2. Embedding 服务不可用（Ollama 未运行）
 * 3. 所有域向量余弦相似度 < 0.5
 */
export function buildIntentPrompt(): string {
  return [
    'You are an e-commerce customer service intent classifier. Always output JSON.',
    '',
    '## Output Format (ALWAYS USE THIS)',
    'Always output a JSON object with these fields:',
    '- "intent": string — the label name with the highest score. If no label reaches 0.5, use "general".',
    '- "labels": array of objects, each with "label" (string) and "score" (number 0.0 to 1.0)',
    '',
    'Supported labels: order, wallet, coupon, user, product, lucky-draw, rag, general.',
    '',
    'Example:',
    '  {{"intent": "order", "labels": [{{"label": "order", "score": 0.9}}, {{"label": "wallet", "score": 0.3}}]}}',
    '',
    '## Previous Intent (context for follow-ups)',
    'previousIntent: {previousIntent}',
    '',
    'CRITICAL RULES for previousIntent + short inputs:',
    '- If user input is 1-3 words AND previousIntent is set to a non-"general" value,',
    "  ALWAYS set previousIntent's score >= 0.7 as the primary intent.",
    '- Confirmation keywords like "yes", "yes please proceed", "confirm", "proceed",',
    '  "ok", "do it", "go ahead", "sure", "correct" strongly suggest continuing the',
    '  previous topic — give previousIntent >= 0.8 for these keywords.',
    '- Topic switch requires explicit rejection keywords like "no", "instead",',
    '  "actually", "different", "change" — only then override previousIntent.',
    '',
    '## Conversation History (for context)',
    '{conversationContext}',
    '',
    '## Active Flow State',
    'activeFlow: {flowStateActiveFlow}',
    'flowStep: {flowStateStep}',
    '',
    "If activeFlow is set (not empty), route short confirmations to the active flow's domain.",
    '',
    '## CRITICAL RULES',
    '1. ALWAYS output valid JSON. No exceptions.',
    '2. Include ALL labels with score >= 0.3 in the labels array.',
    '3. The "intent" field MUST match the highest-scoring label name.',
    '4. If ALL labels are below 0.5, set intent to "general" with a single label (label="general", score=0.5).',
    '5. For multi-domain requests (user mentions multiple topics), assign scores >= 0.7 to each relevant label.',
    '6. No markdown, no backticks, no extra text — ONLY the JSON object.',
  ].join('\n');
}
