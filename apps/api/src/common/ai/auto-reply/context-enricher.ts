import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { CommentContext } from './interfaces/auto-reply.types';

/**
 * Enriches comment context with article metadata from the database.
 */
@Injectable()
export class ContextEnricher {
  private readonly logger = new Logger(ContextEnricher.name);

  constructor(private prisma: PrismaService) {}

  async enrich(
    commentContent: string,
    articleId: string,
    author?: string,
  ): Promise<CommentContext> {
    const ctx: CommentContext = {
      content: commentContent,
      author,
      articleTitle: '',
    };

    try {
      const article = await this.prisma.blogArticle.findUnique({
        where: { id: articleId },
        include: {
          tags: { select: { name: true } },
          category: { select: { name: true } },
        },
      });

      if (article) {
        ctx.articleTitle = article.title || '';
        ctx.articlePreview = article.content
          ? article.content.replace(/[#*`[\]]/g, '').slice(0, 500)
          : undefined;
        ctx.articleTags =
          article.tags?.map((t: { name: any }) => {
            const tagName = t.name;
            // BlogTag.name is JSON (e.g. { "en": "JavaScript", "zh": "JavaScript" })
            if (tagName && typeof tagName === 'object') {
              const obj = tagName as Record<string, unknown>;
              return (
                (Object.values(obj).find(
                  (v) => typeof v === 'string',
                ) as string) || ''
              );
            }
            return String(tagName ?? '');
          }) || [];
        ctx.articleCategory = article.category?.name
          ? (() => {
              const catName = article.category!.name;
              if (catName && typeof catName === 'object') {
                const obj = catName as Record<string, unknown>;
                return (
                  (Object.values(obj).find(
                    (v) => typeof v === 'string',
                  ) as string) || ''
                );
              }
              return String(catName ?? '');
            })()
          : undefined;

        // Simple language detection based on character range
        ctx.language = this.detectLanguage(commentContent);
      }
    } catch (err) {
      this.logger.warn(
        `Failed to enrich context for article ${articleId}: ${err instanceof Error ? err.message : err}`,
      );
      // Non-fatal: continue with available data
      ctx.articleTitle = articleId;
    }

    return ctx;
  }

  private detectLanguage(text: string): string {
    // Count CJK characters
    const cjkCount = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
    const totalChars = text.replace(/\s/g, '').length;

    if (totalChars === 0) return 'en';

    // If >30% of non-space chars are CJK, treat as Chinese
    if (cjkCount / totalChars > 0.3) return 'zh';

    return 'en';
  }
}
