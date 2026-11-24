import { AIMessage } from '@langchain/core/messages';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { createLLM } from '@api/client/ai-customer/graph/llm-factory';
import type { LlmProviderConfig } from '@api/client/ai-customer/graph/llm-factory';
import {
  AgentState,
  OrchestratorStateUpdate,
  RagCitation,
} from '@api/client/ai-customer/graph/state';
import { extractUserInput } from '@api/client/ai-customer/graph/utils/extract-user-input';
import { formatMessage } from '@api/client/ai-customer/graph/utils/format-message-preview';
import { RagRetrievalService } from '@api/client/ai-customer/knowledge/rag-retrieval.service';
import type { RetrievedChunk } from '@api/client/ai-customer/knowledge/rag-retrieval.service';
import type { QueryRewriteService } from '@api/client/ai-customer/knowledge/query-rewrite.service';
import {
  RAG_PROMPT,
  RAG_FALLBACK_PROMPT,
} from '@api/client/ai-customer/graph/agents/prompts/rag-prompt';
import { GENERAL_CHAT_PROMPT } from '@api/client/ai-customer/graph/agents/prompts/general-chat-prompt';
import {
  formatContextSummary,
  trimContextToBudget,
} from '@api/client/ai-customer/graph/utils/context-manager';
import { Logger } from '@nestjs/common';

/**
 * handleGeneralChat — 无标签匹配时的 fallback 通用对话处理器
 */
export async function handleGeneralChat(
  state: typeof AgentState.State,
  llmConfig: LlmProviderConfig,
): Promise<OrchestratorStateUpdate> {
  const userInput = extractUserInput(state);
  const contextMessages = trimContextToBudget(state.messages, {
    maxTokens: 3_000,
  })
    .filter((m: any) => m.type === 'human' || m.type === 'ai')
    .slice(0, -1);
  const conversationContext = [
    state.userMemory,
    formatContextSummary(state.contextState),
    contextMessages.length > 0
      ? contextMessages.map(formatMessage).join('\n')
      : '(no recent conversation)',
  ]
    .filter(Boolean)
    .join('\n\n');
  const model = createLLM(llmConfig, { temperature: 0.7 });
  const chain = GENERAL_CHAT_PROMPT.pipe(model).pipe(new StringOutputParser());
  const result = await chain.invoke({ input: userInput, conversationContext });
  return {
    messages: [...state.messages, new AIMessage(result)],
    previousIntent: state.intent,
    labels: [],
    pendingConfirm: null,
    // 通用闲聊走代码内置 prompt，没有 DB 版本可归因。
    promptBinding: {
      name: 'general-chat',
      version: null,
      source: 'code',
      agent: 'general-chat',
    },
    promptBindings: [],
  };
}

/**
 * handleRagQuery — 知识库检索处理器
 */
const CITATION_PREVIEW_CHARS = 1500;

/** 把检索结果转成可下发/可落库的引用（内容截断，避免把整篇文档写进 meta）。 */
export function toRagCitations(results: RetrievedChunk[]): RagCitation[] {
  return results.map((r) => ({
    chunkId: r.chunkId,
    documentId: r.documentId,
    docId: r.docId,
    title: r.title,
    domain: r.domain,
    score: r.score,
    content: r.content.slice(0, CITATION_PREVIEW_CHARS),
  }));
}

export interface RagQueryOptions {
  /** 查询改写（中文 → 英文），失败时按 null 处理，不影响原问句检索 */
  queryRewriteService?: QueryRewriteService;
  /** 编排层已预取的检索结果；传入时不再检索一次 */
  prefetchedResults?: RetrievedChunk[];
}

/**
 * 检索知识库：原问句 + 英文改写变体。
 *
 * 单独抽出来是为了让「预取」和「真正生成回答」共用同一次检索，
 * 而不是在编排收尾再查一遍。
 */
export async function retrieveKnowledge(
  userInput: string,
  ragRetrievalService: RagRetrievalService,
  queryRewriteService?: QueryRewriteService,
): Promise<RetrievedChunk[]> {
  const rewritten = queryRewriteService
    ? await queryRewriteService.rewrite(userInput).catch(() => null)
    : null;
  return ragRetrievalService.retrieve(userInput, {
    topK: 3,
    queryVariants: rewritten ? [rewritten] : undefined,
  });
}

export async function handleRagQuery(
  state: typeof AgentState.State,
  llmConfig: LlmProviderConfig,
  ragRetrievalService: RagRetrievalService,
  /**
   * 跨版本告知（可选）：上一轮用的是旧版政策时，提醒模型以本次为准。
   * 放在文档块最前面，模型会把它当作本次检索的上下文提示。
   */
  versionNotice?: string | null,
  options?: RagQueryOptions,
): Promise<OrchestratorStateUpdate> {
  const logger = new Logger('Orchestrator');
  const userInput = extractUserInput(state);
  const results =
    options?.prefetchedResults ??
    (await retrieveKnowledge(
      userInput,
      ragRetrievalService,
      options?.queryRewriteService,
    ));
  if (results.length === 0) {
    logger.log(
      '[orchestrator] RAG: no relevant documents found, using fallback',
    );
    const model = createLLM(llmConfig, { temperature: 0.3 });
    const chain = RAG_FALLBACK_PROMPT.pipe(model).pipe(
      new StringOutputParser(),
    );
    const result = await chain.invoke({
      input: userInput,
      memory: state.userMemory ?? '',
    });
    return {
      messages: [...state.messages, new AIMessage(result)],
      previousIntent: state.intent,
      labels: [],
      pendingConfirm: null,
      ragSources: [],
      promptBinding: {
        name: 'rag-fallback',
        version: null,
        source: 'code',
        agent: 'rag',
      },
      promptBindings: [],
    };
  }
  const documents = [
    versionNotice ?? null,
    ...results.map(
      (r: any) =>
        `## ${r.title} (domain: ${r.domain}, priority: ${r.priority})\n${r.content}`,
    ),
  ]
    .filter(Boolean)
    .join('\n\n---\n\n');
  const model = createLLM(llmConfig, { temperature: 0.3 });
  const chain = RAG_PROMPT.pipe(model).pipe(new StringOutputParser());
  const result = await chain.invoke({
    input: userInput,
    documents,
    memory: state.userMemory ?? '',
  });
  return {
    messages: [...state.messages, new AIMessage(result)],
    previousIntent: state.intent,
    labels: [],
    pendingConfirm: null,
    ragSources: toRagCitations(results),
    promptBinding: {
      name: 'rag',
      version: null,
      source: 'code',
      agent: 'rag',
    },
    promptBindings: [],
  };
}
