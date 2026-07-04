/**
 * intent-prompt-builder — INTENT_PROMPT 模板构建器
 *
 * ── 是什么？ ──
 * 遵循 prompt-builder.ts 的 Template Method Pattern 设计，
 * 将 INTENT_PROMPT 拆分为：
 * 1. 模板骨架（Output Format, Previous Intent, Flow State, CRITICAL RULES）— 固定
 * 2. Label Categories 配置（intent-label-categories.ts）— 动态扩展
 * 3. Builder 函数（本文件）— 组装
 *
 * ── 为什么用 string replace 而非插值？ ──
 * 因为 LangChain ChatPromptTemplate.fromMessages() 会解析 {content} 为模板变量。
 * 如果 Label Categories 中包含 { 和 } 字符（即使用模板插值），
 * LangChain 会将它们解析为模板变量引用，导致 "Missing value for input variable" 错误。
 * 因此使用 replace('{LABEL_CATEGORIES}', ...) 避免 LangChain 解析。
 */

import { INTENT_LABEL_CATEGORIES, LabelCategory } from './intent-label-categories';

// ============================================================
// Private Helpers
// ============================================================

/**
 * 构建单个标签分类章节
 */
function buildLabelSection(cat: LabelCategory): string {
  const lines: string[] = [];

  // 标题
  lines.push(`### ${cat.name} (${cat.domainType})`);

  // 评分指南
  lines.push('Score guide:');
  for (const guide of cat.scoreGuide) {
    lines.push(`- ${guide}`);
  }

  // 关键词（可选）
  if (cat.keywords && cat.keywords.length > 0) {
    lines.push('');
    lines.push(`Keywords: ${cat.keywords.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * 构建完整的 Label Categories 章节（所有域拼接）
 */
function buildLabelCategoriesSection(): string {
  return INTENT_LABEL_CATEGORIES.map(buildLabelSection).join('\n\n');
}

// ============================================================
// Public API
// ============================================================

/**
 * 构建完整的 INTENT_PROMPT system prompt 字符串
 *
 * 调用时机：模块加载时（ChatPromptTemplate.fromMessages 前），非每请求调用。
 * 模板变量 {previousIntent}, {conversationContext}, {flowStateActiveFlow}, {flowStateStep}
 * 由 LangChain ChatPromptTemplate 运行时注入。
 */
export function buildIntentPrompt(): string {
  const labelSections = buildLabelCategoriesSection();

  // 模板骨架：稳定的章节（Output Format, Previous Intent, Flow State, CRITICAL RULES）
  // NOTE: 不要将 {LABEL_CATEGORIES} 改为模板变量，否则 LangChain 会尝试解析它。
  // 使用 String.prototype.replace 在构建时替换。
  const skeleton = [
    'You are an e-commerce customer service intent classifier. Always output JSON.',
    '',
    '## Output Format (ALWAYS USE THIS)',
    'Always output a JSON object with these fields:',
    '- "intent": string — the highest-scoring label name. If no label reaches 0.5, use "general".',
    '- "labels": array of objects, each with "label" (string) and "score" (number 0.0 to 1.0)',
    '',
    'Example structure (use parentheses not curly braces in description):',
    '  intent = "order"',
    '  labels = [ (label: "order", score: 0.92), (label: "coupon", score: 0.75) ]',
    '',
    '- Include ALL labels with score >= 0.3 in the labels array.',
    '- Scores are 0.0 (definitely not) to 1.0 (definitely yes).',
    '- CRITICAL: Output ONLY valid JSON. No markdown, no backticks, no extra text.',
    '',
    '## Previous Intent (strong hint for short follow-ups)',
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
    '- When previousIntent is "none" or "general", use the conversation history below.',
    '',
    '## Conversation History (for context)',
    '{conversationContext}',
    '',
    'Use the conversation to understand follow-ups. The conversation above shows',
    'the recent assistant responses and user messages.',
    '',
    '## Active Flow State',
    'activeFlow: {flowStateActiveFlow}',
    'flowStep: {flowStateStep}',
    '',
    'If activeFlow is set (not empty), this means there is an ongoing multi-step',
    "process like withdrawal or address management. Short confirmation inputs MUST",
    "route to the active flow's domain. Only override if user explicitly says \"no\"",
    'or mentions a completely different topic.',
    '',
    '## Label Categories (score criteria)',
    '',
    '{LABEL_CATEGORIES}',
    '',
    '## CRITICAL RULES',
    '1. ALWAYS output valid JSON. No exceptions.',
    '2. Include ALL labels with score >= 0.3 in the labels array.',
    '3. The "intent" field MUST match the highest-scoring label name.',
    '4. If ALL labels are below 0.5, set intent to "general" with a single label (label="general", score=0.5).',
    '5. For multi-domain requests (user mentions multiple topics), assign scores >= 0.7 to each relevant label.',
    '6. No markdown, no backticks, no extra text — ONLY the JSON object.',
  ].join('\n');

  return skeleton.replace('{LABEL_CATEGORIES}', labelSections);
}
