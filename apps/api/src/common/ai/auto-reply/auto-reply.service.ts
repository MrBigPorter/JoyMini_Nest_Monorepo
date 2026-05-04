import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { CommentClassifier } from './comment-classifier';
import { ContextEnricher } from './context-enricher';
import { ReplyValidator } from './reply-validator';
import { buildPrompt } from './prompts';
import {
  CommentContext,
  CommentType,
  ReplyResult,
} from './interfaces/auto-reply.types';
import { AiService, AiGenerationOptions } from '../ai.service';

@Injectable()
export class AutoReplyService {
  private readonly logger = new Logger(AutoReplyService.name);
  private readonly MAX_ATTEMPTS = 3;

  constructor(
    private readonly commentClassifier: CommentClassifier,
    private readonly contextEnricher: ContextEnricher,
    private readonly replyValidator: ReplyValidator,
    @Inject(forwardRef(() => AiService))
    private readonly aiService: AiService,
  ) {}

  /**
   * Generate a natural, context-aware auto-reply for a blog comment.
   *
   * Pipeline:
   *   1. Classify comment type (praise, question, etc.)
   *   2. Enrich context with article metadata from DB
   *   3. Build type-specific prompt with few-shot examples
   *   4. Call AI provider
   *   5. Validate reply — retry up to MAX_ATTEMPTS if too robotic
   */
  async generateReply(
    commentContent: string,
    articleId: string,
    author?: string,
  ): Promise<ReplyResult> {
    // Step 1: Classify
    const commentType = this.commentClassifier.classify(commentContent);

    // Step 2: Enrich context
    const ctx = await this.contextEnricher.enrich(
      commentContent,
      articleId,
      author,
    );

    // Step 3-5: Generate with retry
    for (let attempt = 1; attempt <= this.MAX_ATTEMPTS; attempt++) {
      const reply = await this.attemptGenerate(commentType, ctx, attempt);

      if (reply === null) {
        // Provider returned null (rate limited, etc.) — no point retrying
        return {
          content: this.buildFallbackReply(commentType, ctx),
          commentType,
          attempts: attempt,
          validated: false,
        };
      }

      // Step 5: Validate
      if (this.replyValidator.validate(reply)) {
        return {
          content: reply,
          commentType,
          attempts: attempt,
          validated: true,
        };
      }

      if (attempt < this.MAX_ATTEMPTS) {
        this.logger.debug(
          `Reply failed validation (attempt ${attempt}/${this.MAX_ATTEMPTS}), retrying...`,
        );
      }
    }

    // All attempts exhausted — return fallback
    return {
      content: this.buildFallbackReply(commentType, ctx),
      commentType,
      attempts: this.MAX_ATTEMPTS,
      validated: false,
    };
  }

  private async attemptGenerate(
    commentType: CommentType,
    ctx: CommentContext,
    attempt: number,
  ): Promise<string | null> {
    const template = buildPrompt(commentType, ctx);

    const options: AiGenerationOptions = {
      temperature: template.temperature,
      maxOutputTokens: template.maxTokens,
      systemPrompt: template.systemPrompt,
    };

    // Build the user message with context
    const userMessage = this.buildUserMessage(commentType, ctx);

    const result = await this.aiService.generateText(userMessage, options);

    if (result === null) {
      this.logger.warn(
        `AI provider returned null for auto-reply (type: ${commentType}, attempt: ${attempt})`,
      );
    }

    return result;
  }

  private buildUserMessage(
    commentType: CommentType,
    ctx: CommentContext,
  ): string {
    let message = `Article: "${ctx.articleTitle}"\n`;
    if (ctx.articleTags?.length) {
      message += `Tags: ${ctx.articleTags.join(', ')}\n`;
    }
    if (ctx.articleCategory) {
      message += `Category: ${ctx.articleCategory}\n`;
    }
    if (ctx.readingTime) {
      message += `Reading time: ${ctx.readingTime} min\n`;
    }
    message += `\nComment: "${ctx.content}"\n\n`;
    message += `Generate a natural technical reply as the article author:`;

    return message;
  }

  /**
   * Build a simple rule-based fallback reply when AI is unavailable.
   * These are better than nothing but still simple — AI is always preferred.
   */
  private buildFallbackReply(
    commentType: CommentType,
    ctx: CommentContext,
  ): string {
    switch (commentType) {
      case CommentType.PRAISE:
        return `感谢阅读！希望内容对你有帮助，欢迎继续交流~`;
      case CommentType.QUESTION:
        return `好问题！文章里可能没有展开说，你具体碰到什么问题了？我们可以一起讨论下。`;
      case CommentType.SUGGESTION:
        return `好建议，我记下了！后续写文章的时候会考虑这个方向。`;
      case CommentType.BUG_REPORT:
        return `感谢反馈！能详细说说你的环境配置和复现步骤吗？我来确认一下。`;
      case CommentType.CRITICISM:
        return `感谢指正，这个角度确实值得再深入思考。方便具体说说你觉得可以改进的地方吗？`;
      default:
        return `感谢评论！有具体问题欢迎继续讨论~`;
    }
  }
}
