import { Logger } from '@nestjs/common';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { createLLM } from '@api/client/ai-customer/graph/llm-factory';
import type { LlmProviderConfig } from '@api/client/ai-customer/graph/llm-factory';
import { SYNTHESIZER_PROMPT } from '@api/client/ai-customer/graph/agents/prompts/synthesizer-prompt';
import { AgentState, DebugAgentExecution } from '@api/client/ai-customer/graph/state';

/**
 * synthesizeAnswers — 将多个 Agent 的输出合并为一条最终回复
 * 三路逻辑：空→fallback、单个→直接返回、多个→LLM 合成
 */
export async function synthesizeAnswers(
  llmConfig: LlmProviderConfig,
  agentOutputs: { label: string; content: string }[],
  userInput: string,
): Promise<string> {
  const validOutputs = agentOutputs.filter(
    (o) => o.content && o.content.length > 0,
  );
  if (validOutputs.length === 0) {
    return 'Sorry, I could not find the information you requested. Please try again later or contact our customer support team for assistance.';
  }
  if (validOutputs.length === 1) {
    return validOutputs[0].content;
  }
  const agentOutput = validOutputs
    .map((o) => `[${o.label}]: ${o.content}`)
    .join('\n\n');
  const model = createLLM(llmConfig, { temperature: 0.5 });
  const chain = SYNTHESIZER_PROMPT.pipe(model).pipe(new StringOutputParser());
  return chain.invoke({
    agentOutput: agentOutput || 'No results found.',
    userInput,
  });
}

/** 生成标准 Agent 错误提示文案 */
export function AGENT_ERROR_MSG(label: string): string {
  return `Sorry, I encountered an issue processing your ${label} request.`;
}

/**
 * pushDirectResult — 将 direct handler 的结果推入 agentOutputs + debugAgents
 */
export function pushDirectResult(
  label: string,
  result: Partial<typeof AgentState.State>,
  agentOutputs: { label: string; content: string }[],
  debugAgents?: DebugAgentExecution[],
): void {
  const lastMsg = result.messages?.[result.messages.length - 1];
  const content = typeof lastMsg?.content === 'string' ? lastMsg.content : '';
  agentOutputs.push({ label, content });
  if (debugAgents) {
    debugAgents.push({
      label,
      tools: [],
      contextMessages: 0,
      lastMsg: '',
      status: 'OK',
      resultPreview: content.slice(0, 200),
    });
  }
}

/**
 * pushAgentResult — 将标准 Agent 的执行结果推入 agentOutputs + debugAgents
 */
export function pushAgentResult(
  label: string,
  result: { content?: string; error?: string },
  agentOutputs: { label: string; content: string }[],
  debugAgents: DebugAgentExecution[] | undefined,
  toolNames: string,
  contextMessagesCount: number,
  logger?: Logger,
): { forceTransfer: boolean } {
  const isError = !!result.error;
  let content = isError ? AGENT_ERROR_MSG(label) : (result.content ?? '');
  const forceTransfer = content.includes('[TRANSFER_TO_HUMAN]');
  if (forceTransfer) {
    content = content.replace('[TRANSFER_TO_HUMAN]', '').trim();
  }
  agentOutputs.push({ label, content });
  if (debugAgents) {
    debugAgents.push({
      label,
      tools: toolNames.split(', ').filter(Boolean),
      contextMessages: contextMessagesCount,
      lastMsg: '',
      status: isError ? 'ERROR' : 'OK',
      resultPreview: content.slice(0, 200),
    });
  }
  return { forceTransfer };
}
