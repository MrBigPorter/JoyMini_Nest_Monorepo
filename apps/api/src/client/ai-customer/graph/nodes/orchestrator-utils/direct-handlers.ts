import { AIMessage } from '@langchain/core/messages';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { createLLM } from '@api/client/ai-customer/graph/llm-factory';
import type { LlmProviderConfig } from '@api/client/ai-customer/graph/llm-factory';
import {
  AgentState,
  OrchestratorStateUpdate,
} from '@api/client/ai-customer/graph/state';
import { extractUserInput } from '@api/client/ai-customer/graph/utils/extract-user-input';
import { formatMessage } from '@api/client/ai-customer/graph/utils/format-message-preview';
import { RagRetrievalService } from '@api/client/ai-customer/knowledge/rag-retrieval.service';
import { RAG_PROMPT, RAG_FALLBACK_PROMPT } from '@api/client/ai-customer/graph/agents/prompts/rag-prompt';
import { GENERAL_CHAT_PROMPT } from '@api/client/ai-customer/graph/agents/prompts/general-chat-prompt';
import { Logger } from '@nestjs/common';

/**
 * handleGeneralChat — 无标签匹配时的 fallback 通用对话处理器
 */
export async function handleGeneralChat(
  state: typeof AgentState.State,
  llmConfig: LlmProviderConfig,
): Promise<OrchestratorStateUpdate> {
  const userInput = extractUserInput(state);
  const contextMessages = state.messages
    .slice(-10)
    .filter((m: any) => m.type === 'human' || m.type === 'ai')
    .slice(0, -1);
  const conversationContext =
    contextMessages.length > 0
      ? contextMessages.map(formatMessage).join('\n')
      : '(no recent conversation)';
  const model = createLLM(llmConfig, { temperature: 0.7 });
  const chain = GENERAL_CHAT_PROMPT.pipe(model).pipe(new StringOutputParser());
  const result = await chain.invoke({ input: userInput, conversationContext });
  return {
    messages: [...state.messages, new AIMessage(result)],
    previousIntent: state.intent,
    labels: [],
    pendingConfirm: null,
  };
}

/**
 * handleRagQuery — 知识库检索处理器
 */
export async function handleRagQuery(
  state: typeof AgentState.State,
  llmConfig: LlmProviderConfig,
  ragRetrievalService: RagRetrievalService,
): Promise<OrchestratorStateUpdate> {
  const logger = new Logger('Orchestrator');
  const userInput = extractUserInput(state);
  const results = await ragRetrievalService.retrieve(userInput, { topK: 3 });
  if (results.length === 0) {
    logger.log('[orchestrator] RAG: no relevant documents found, using fallback');
    const model = createLLM(llmConfig, { temperature: 0.3 });
    const chain = RAG_FALLBACK_PROMPT.pipe(model).pipe(new StringOutputParser());
    const result = await chain.invoke({ input: userInput });
    return {
      messages: [...state.messages, new AIMessage(result)],
      previousIntent: state.intent,
      labels: [],
      pendingConfirm: null,
    };
  }
  const documents = results
    .map((r: any) => `## ${r.title} (domain: ${r.domain}, priority: ${r.priority})\n${r.content}`)
    .join('\n\n---\n\n');
  const model = createLLM(llmConfig, { temperature: 0.3 });
  const chain = RAG_PROMPT.pipe(model).pipe(new StringOutputParser());
  const result = await chain.invoke({ input: userInput, documents });
  return {
    messages: [...state.messages, new AIMessage(result)],
    previousIntent: state.intent,
    labels: [],
    pendingConfirm: null,
  };
}
