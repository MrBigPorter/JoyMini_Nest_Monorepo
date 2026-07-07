import { ChatPromptTemplate } from '@langchain/core/prompts';
import { buildIntentPrompt } from '@api/client/ai-customer/graph/agents/prompts/intent-prompt-builder';

/**
 * INTENT_PROMPT — LLM Fallback 使用的 System Prompt
 *
 * 旧版本包含 Label Categories 章节（keywords + scoreGuide），
 * 新版本不再需要 —— 域识别由 embedding 向量完成。
 * Fallback LLM 仅处理上下文相关的短输入，prompt 已大幅简化。
 */
export const INTENT_PROMPT = ChatPromptTemplate.fromMessages([
  ['system', buildIntentPrompt()],
  ['human', '{input}'],
]);
