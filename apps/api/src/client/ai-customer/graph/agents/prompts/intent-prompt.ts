import { ChatPromptTemplate } from '@langchain/core/prompts';
import {
  BuildIntentPromptOptions,
  buildIntentPrompt,
} from '@api/client/ai-customer/graph/agents/prompts/intent-prompt-builder';

/**
 * 按注册表快照构造 prompt。
 *
 * 分类器是运行期手工 new 出来的（不是 Nest provider），拿不到 DI 的
 * IntentDomainService，所以由调用方把快照/示例传进来，这里只负责组装。
 */
export function createIntentPrompt(options?: BuildIntentPromptOptions) {
  return ChatPromptTemplate.fromMessages([
    ['system', buildIntentPrompt(options)],
    ['human', '{input}'],
  ]);
}

/**
 * INTENT_PROMPT — LLM Fallback 使用的 System Prompt
 *
 * 旧版本包含 Label Categories 章节（keywords + scoreGuide），
 * 新版本不再需要 —— 域识别由 embedding 向量完成。
 * Fallback LLM 仅处理上下文相关的短输入，prompt 已大幅简化。
 */
export const INTENT_PROMPT = createIntentPrompt();
