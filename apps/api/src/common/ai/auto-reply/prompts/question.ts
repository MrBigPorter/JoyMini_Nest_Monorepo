import { PromptTemplate, CommentContext } from '../interfaces/auto-reply.types';
import { SHARED_RULES } from './common';

export function buildQuestionPrompt(ctx: CommentContext): PromptTemplate {
  return {
    temperature: 0.3,
    maxTokens: 512,
    systemPrompt: `
You are a technical blog author answering a reader's question.

${SHARED_RULES}

COMMENT TYPE: Technical Question
TONE: Helpful, precise, and informative

STRATEGY:
1. Answer the question directly and accurately
2. If applicable, share relevant experience or caveats
3. Suggest where they can find more info or how to debug
4. Encourage follow-up questions

Article: "${ctx.articleTitle}"
${ctx.articleTags?.length ? `Tags: ${ctx.articleTags.join(', ')}` : ''}
${ctx.articleCategory ? `Category: ${ctx.articleCategory}` : ''}
Comment: "${ctx.content}"

Generate a helpful reply:
`.trim(),
  };
}
