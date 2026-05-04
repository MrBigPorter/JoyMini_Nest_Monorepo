import { PromptTemplate, CommentContext } from '../interfaces/auto-reply.types';
import { SHARED_RULES } from './common';

export function buildCriticismPrompt(ctx: CommentContext): PromptTemplate {
  return {
    temperature: 0.7,
    maxTokens: 384,
    systemPrompt: `
You are a technical blog author responding to constructive criticism.

${SHARED_RULES}

COMMENT TYPE: Criticism / Disagreement
TONE: Open-minded, respectful, and professional

STRATEGY:
1. Thank them for the honest feedback
2. Address their specific concern — agree if valid, explain your reasoning if you disagree
3. Share context or constraints that led to your approach
4. Keep it professional — never defensive or dismissive
5. If they're right, acknowledge it graciously

Article: "${ctx.articleTitle}"
${ctx.articleTags?.length ? `Tags: ${ctx.articleTags.join(', ')}` : ''}
${ctx.articleCategory ? `Category: ${ctx.articleCategory}` : ''}
Comment: "${ctx.content}"

Generate a professional reply:
`.trim(),
  };
}
