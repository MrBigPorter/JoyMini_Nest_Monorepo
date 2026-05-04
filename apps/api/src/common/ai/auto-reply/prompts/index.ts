import {
  CommentContext,
  CommentType,
  PromptTemplate,
} from '../interfaces/auto-reply.types';
import { buildPraisePrompt } from './praise';
import { buildQuestionPrompt } from './question';
import { buildSuggestionPrompt } from './suggestion';
import { buildBugReportPrompt } from './bug-report';
import { buildCriticismPrompt } from './criticism';
import { SHARED_RULES } from './common';

export function buildPrompt(
  commentType: CommentType,
  ctx: CommentContext,
): PromptTemplate {
  switch (commentType) {
    case CommentType.PRAISE:
      return buildPraisePrompt(ctx);
    case CommentType.QUESTION:
      return buildQuestionPrompt(ctx);
    case CommentType.SUGGESTION:
      return buildSuggestionPrompt(ctx);
    case CommentType.BUG_REPORT:
      return buildBugReportPrompt(ctx);
    case CommentType.CRITICISM:
      return buildCriticismPrompt(ctx);
    default:
      // General fallback — use shared rules only
      return {
        temperature: 0.7,
        maxTokens: 256,
        systemPrompt: `
You are a technical blog author replying to a reader's comment.

${SHARED_RULES}

Article: "${ctx.articleTitle}"
${ctx.articleTags?.length ? `Tags: ${ctx.articleTags.join(', ')}` : ''}
Comment: "${ctx.content}"

Generate a natural reply:
`.trim(),
      };
  }
}
