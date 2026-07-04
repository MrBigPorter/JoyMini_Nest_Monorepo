/**
 * RAG Node — Phase 1 Stub
 *
 * Phase 1: Static policy document loading
 * Phase 3: Replace with full pgvector vector search
 *
 * This file is a placeholder node to ensure Graph compilation passes.
 */
import { AgentState } from '@api/client/ai-customer/graph/state';

//这是先占位，避免报错
export const ragNode = async (
  state: typeof AgentState.State,
): Promise<Partial<typeof AgentState.State>> => {
  const lastMessage = state.messages[state.messages.length - 1];
  const userInput =
    typeof lastMessage?.content === 'string'
      ? lastMessage.content
      : JSON.stringify(lastMessage?.content ?? '');
  return {
    messages: state.messages,
  };
};
