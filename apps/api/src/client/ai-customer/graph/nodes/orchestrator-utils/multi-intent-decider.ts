import { Logger } from '@nestjs/common';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { createLLM } from '@api/client/ai-customer/graph/llm-factory';
import type { LlmProviderConfig } from '@api/client/ai-customer/graph/llm-factory';

const MULTI_INTENT_DECISION_PROMPT = ChatPromptTemplate.fromTemplate(
  `You are an intent routing assistant. The user's message matched multiple business domains.

Previous intent: {previousIntent}
Previous assistant message: "{previousAssistantMessage}"

User message: "{userInput}"

Matched domains:
{domainList}

Your job: decide what to do.
- If the user clearly wants ONE specific thing → respond: single:<domainName>
- If the user's message relates to ALL matched domains → respond: all
- If you are UNCERTAIN which one the user wants → respond: ask:<your clarifying question in the user's language>

Rules:
1. Use PREVIOUS INTENT as context. If user's short reply (e.g. "status", "yes", "check it") follows up on previous conversation, route to the relevant domain.
2. "single" when user clearly wants one thing (consider previous context)
3. "all" when query touches multiple domains
4. "ask" when ambiguous - generate a clarifying question

Examples:
- previous=kyc, user="status" → single:kyc
- previous=kyc, user="check it" → single:kyc
- previous=coupon, user="balance" → single:wallet
- "show my coupons" → single:coupon
- "kyc" → ask:Would you like to check your KYC verification status or learn about KYC policies?

Respond with ONLY one line, no explanation.`,
);

export interface MultiIntentDecision {
  action: 'single' | 'all' | 'ask';
  domain?: string;
  message?: string;
}

/**
 * decideMultiIntentWithLLM — 多个 domain 匹配时由 LLM 判断
 */
export async function decideMultiIntentWithLLM(
  llmConfig: LlmProviderConfig,
  userInput: string,
  domains: { label: string; score: number }[],
  logger: Logger,
  previousIntent?: string,
  previousAssistantMessage?: string,
): Promise<MultiIntentDecision> {
  const domainList = domains
    .map((d, i) => `${i + 1}. ${d.label} (score: ${d.score.toFixed(2)})`)
    .join('\n');
  const model = createLLM(llmConfig, { temperature: 0 });
  const chain = MULTI_INTENT_DECISION_PROMPT.pipe(model).pipe(new StringOutputParser());
  const raw = await chain.invoke({
    userInput,
    domainList,
    previousIntent: previousIntent || 'none',
    previousAssistantMessage: previousAssistantMessage || '(no previous message)',
  });
  const trimmed = raw.trim().toLowerCase();
  logger.log(`[orchestrator] multi-intent LLM raw decision: "${trimmed}"`);

  if (trimmed.startsWith('single:')) {
    return { action: 'single', domain: trimmed.slice(7).trim() };
  }
  if (trimmed === 'all') {
    return { action: 'all' };
  }
  if (trimmed.startsWith('ask:')) {
    return { action: 'ask', message: trimmed.slice(4).trim() };
  }
  return {
    action: 'ask',
    message: 'I found several topics that might match your request. Could you please clarify what you need?',
  };
}
