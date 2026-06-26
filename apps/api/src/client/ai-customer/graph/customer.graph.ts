import { StateGraph, START, END } from '@langchain/langgraph';
import { AgentState } from './state';
import { intentRouterNode, routerByIntent } from './nodes/intent-router.node';
import { answerSynthesizerNode } from './nodes/answer-synthesizer.node';
import { generalChatNode } from './nodes/general-chat.node';
import { orderAgentNode } from './nodes/order-agent.node';
import { ragNode } from './nodes/rag.node';

/**
 * Build and compile the AI Customer StateGraph
 *
 * Node flow:
 * 1. START → intentRouter (classify user intent)
 * 2. intentRouter → routerByIntent (conditional edge to agent)
 * 3. Agent/RAG/GeneralChat → answerSynthesizer
 * 4. answerSynthesizer → END
 */
export function buildCustomerGraph() {
  const workflow = new StateGraph(AgentState)
    // ── Register all nodes ──
    .addNode('intentRouter', intentRouterNode)
    .addNode('ragNode', ragNode)
    .addNode('orderAgent', orderAgentNode)
    .addNode('generalChat', generalChatNode)
    .addNode('answerSynthesizer', answerSynthesizerNode)

    // ── Edges ──
    // Start → Intent Router
    .addEdge(START, 'intentRouter')

    // Intent Router → Route by intent (conditional)
    .addConditionalEdges('intentRouter', routerByIntent, {
      ragNode: 'ragNode',
      generalChat: 'generalChat',
      orderAgent: 'orderAgent',
    })

    // All agent/nodes → Answer Synthesizer
    .addEdge('orderAgent', 'answerSynthesizer')
    .addEdge('ragNode', 'answerSynthesizer')
    .addEdge('generalChat', 'answerSynthesizer')

    // Answer Synthesizer → END
    .addEdge('answerSynthesizer', END);

  // Compile the graph
  return workflow.compile();
}
