import {
  Processor,
  WorkerHost,
  OnWorkerEvent,
  InjectQueue,
} from '@nestjs/bullmq';
import { Marked } from 'marked';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { AiService, AiServiceLevel } from '@api/common/ai/ai.service';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { TranslationJobService } from '../translation-job.service';
import { CommentStatus } from '@prisma/client';
import { repairJsonResponse } from '../utils/repair-json';

@Processor('blog-ai', {
  concurrency: 1, // 保持串行处理
  limiter: {
    max: 60, // ⬆️ 从5提高到60: DeepSeek 付费 API 无速率限制，可以更快处理队列
    duration: 60000,
  },
})
export class BlogAiProcessor extends WorkerHost {
  private readonly logger = new Logger(BlogAiProcessor.name);
  private readonly marked: Marked;
  private readonly rateLimitDelayBase = 1000; // 1秒基础延迟
  private readonly rateLimitDelayMax = 30000; // 30秒最大延迟
  private readonly interRequestDelay = 50; // 50ms between API calls (reduced from 500ms for DeepSeek, which has no rate limits)
  private readonly translationCache = new Map<
    string,
    { result: string; timestamp: number }
  >();
  private readonly cacheTTL = 60 * 60 * 1000; // 1小时缓存时间

  constructor(
    private aiService: AiService,
    private prisma: PrismaService,
    private translationJobService: TranslationJobService,
    @InjectQueue('blog-ai') private blogAiQueue: Queue,
  ) {
    super();
    this.marked = new Marked({
      gfm: true,
      breaks: true,
    });
    // 定期清理过期缓存
    setInterval(() => this.cleanupCache(), 5 * 60 * 1000); // 每5分钟清理一次
  }

  /**
   * 清理过期缓存
   */
  private cleanupCache(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, value] of this.translationCache.entries()) {
      if (now - value.timestamp > this.cacheTTL) {
        this.translationCache.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug(`清理了 ${cleanedCount} 个过期翻译缓存项`);
    }
  }

  /**
   * 智能退避延迟方法，用于处理API速率限制
   * @param retryCount 重试次数
   * @param error 错误对象（可选）
   */
  private async handleRateLimit(
    retryCount: number,
    error?: any,
  ): Promise<void> {
    // 检查是否是429错误
    const isRateLimitError =
      error &&
      (error.code === 429 ||
        error.status === 'RESOURCE_EXHAUSTED' ||
        (error.message && error.message.includes('Too Many Requests')) ||
        (error.message && error.message.includes('Resource exhausted')));

    if (isRateLimitError) {
      // 智能退避策略：
      // 1. 第一次遇到429：等待5秒（让API恢复）
      // 2. 第二次遇到429：等待15秒（更长的恢复时间）
      // 3. 第三次及以上：等待30秒（最大等待时间）
      let delay: number;
      if (retryCount === 0) {
        delay = 5000; // 5秒
      } else if (retryCount === 1) {
        delay = 15000; // 15秒
      } else {
        delay = 30000; // 30秒
      }

      // 添加随机抖动避免多个任务同时重试
      const jitter = Math.random() * 2000; // 0-2秒随机抖动
      const totalDelay = delay + jitter;

      this.logger.warn(
        `遇到API速率限制，等待 ${Math.round(totalDelay / 1000)}秒 后继续 (重试次数: ${retryCount + 1})`,
        {
          errorCode: error?.code,
          errorStatus: error?.status,
          errorMessage: error?.message,
          delaySeconds: Math.round(totalDelay / 1000),
          retryCount: retryCount + 1,
        },
      );

      await new Promise((resolve) => setTimeout(resolve, totalDelay));
    } else if (retryCount > 0) {
      // 非速率限制错误的简单延迟
      const delay = this.rateLimitDelayBase * retryCount;
      this.logger.debug(`等待 ${delay}ms 后重试 (重试次数: ${retryCount})`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  /**
   * 在API调用之间添加延迟，均匀分布请求频率以防止速率限制
   */
  private async delayBetweenRequests(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, this.interRequestDelay));
  }

  /**
   * 带重试机制的翻译方法
   * @param text 要翻译的文本
   * @param targetLang 目标语言
   * @param maxRetries 最大重试次数
   * @param isMarkdown 是否是Markdown格式
   */
  private async translateWithRetry(
    text: string,
    targetLang: string,
    maxRetries: number = 2,
    isMarkdown: boolean = false,
  ): Promise<string> {
    // 1. 检查缓存
    const cacheKey = `${text}-${targetLang}-${isMarkdown ? 'md' : 'txt'}`;
    const cached = this.translationCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      this.logger.debug(
        `使用缓存翻译结果 (长度: ${text.length}, 目标语言: ${targetLang})`,
      );
      return cached.result;
    }

    // Bug 4 fix: AI service unavailable → wait 120s then check again
    // This allows Groq Keys that were temporarily exhausted (429 + strict mode)
    // to recover instead of failing immediately.
    if (!this.aiService.isAvailable()) {
      this.logger.warn(
        `⚠️ AI服务当前不可用（Groq Key可能已耗尽），等待 120s 后自动重试...`,
        { targetLang, textLength: text.length },
      );
      await new Promise((resolve) => setTimeout(resolve, 120000));

      // After waiting, check again — if still unavailable, then fail
      if (!this.aiService.isAvailable()) {
        this.logger.warn(
          `⌛ AI服务等待超时：120s后仍不可用（目标语言 ${targetLang}，文本长度 ${text.length}），抛出错误`,
        );
        throw new Error(
          `翻译失败：AI服务不可用（目标语言 ${targetLang}，文本长度 ${text.length}）`,
        );
      }
    }

    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // 如果不是第一次尝试，先等待（速率限制退避 + 频率控制延迟）
        if (attempt > 0) {
          await this.handleRateLimit(attempt - 1, lastError);
          await this.delayBetweenRequests();
        }

        let result: string;
        if (isMarkdown) {
          result = await this.aiService.translateMarkdown(text, targetLang);
        } else {
          result = await this.aiService.translateText(text, targetLang);
        }

        // 检查翻译质量 - 如果结果与原文相同，可能是翻译失败
        if (result === text && text.trim().length > 0) {
          // 如果原文已经是英文/目标语言，这不是失败，直接返回
          // 例如标题 "Blog System Architecture" 翻译到英文时 DeepSeek 会原样返回
          if (this.isEnglishText(text)) {
            this.logger.debug(
              `原文已是英文，跳过重试直接使用 (目标语言: ${targetLang})`,
            );
            this.translationCache.set(cacheKey, {
              result,
              timestamp: Date.now(),
            });
            return result;
          }

          this.logger.warn(
            `翻译结果与原文相同，可能翻译失败 (尝试 ${attempt + 1}/${maxRetries + 1})`,
            {
              text: text.substring(0, 100),
              result: result.substring(0, 100),
              targetLang,
            },
          );

          // Bug 4 fix: AI is down mid-retry → fail fast instead of burning more failure slots
          if (!this.aiService.isAvailable()) {
            throw new Error(
              `翻译失败：AI服务不可用（目标语言 ${targetLang}，文本长度 ${text.length}）`,
            );
          }

          // 如果是最后一次尝试，不再抛错，直接返回原文
          // 这样不会让整篇文章的翻译任务 FAILED，继续后续内容翻译
          if (attempt === maxRetries) {
            this.logger.warn(
              `翻译结果与原文相同，直接使用原文 (长度 ${text.length}, 目标语言 ${targetLang})`,
            );
            this.translationCache.set(cacheKey, {
              result,
              timestamp: Date.now(),
            });
            return result;
          }
          continue;
        }

        // 缓存结果
        this.translationCache.set(cacheKey, {
          result,
          timestamp: Date.now(),
        });

        return result;
      } catch (error) {
        lastError = error;

        // === Key 耗尽检测：Groq 所有 Key 不可用 + strict 模式 ===
        // translateText() 抛出 "Translation failed: AI returned null..."
        // 表示 strict 模式下 Groq 所有 Key 已耗尽，不进行回退。
        // 此时等待 120s（匹配 Groq KEY_429_COOLDOWN_DEFAULT），让被封 Key 恢复。
        const isKeysExhausted =
          error instanceof Error && error.message.includes('AI returned null');

        if (isKeysExhausted) {
          const waitMs = 120000; // 2分钟，匹配 Groq KEY_429_COOLDOWN_DEFAULT
          this.logger.warn(
            `⚠️ Groq API 所有 Key 已暂时耗尽，等待 ${waitMs / 1000}s 后自动重试...`,
            {
              attempt: attempt + 1,
              maxRetries: maxRetries + 1,
              targetLang,
            },
          );

          await new Promise((resolve) => setTimeout(resolve, waitMs));

          // 继续重试（不抛错，等待 Key 恢复）
          // 120s 后被封 Key 应该已恢复，继续重试大概率成功
          if (attempt < maxRetries) {
            continue;
          }

          // 最后一次尝试也耗尽 → 返回原文，不抛错，避免标记 FAILED
          this.logger.warn(
            `⌛ 翻译等待超时：所有 Groq Key 仍不可用（目标语言 ${targetLang}，文本长度 ${text.length}），返回原文待下次处理`,
          );
          return text;
        }
        // === Key 耗尽检测结束 ===

        this.logger.error(`翻译失败 (尝试 ${attempt + 1}/${maxRetries + 1})`, {
          error: error instanceof Error ? error.message : 'Unknown error',
          textLength: text.length,
          targetLang,
        });

        // 如果是最后一次尝试，抛出错误
        if (attempt === maxRetries) {
          throw error;
        }
      }
    }

    // 理论上不会执行到这里
    return text;
  }

  /**
   * 批量翻译文章方法 - 将标题、摘要、正文合并为单个请求
   * @param article 文章对象
   * @param targetLang 目标语言
   * @param sourceLang 源语言
   */
  private async batchTranslateArticle(
    article: any,
    targetLang: string,
    sourceLang: string,
  ): Promise<{ title: string; content: string; excerpt: string | null }> {
    const cacheKey = `batch-${article.id}-${targetLang}`;
    const cached = this.translationCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      this.logger.debug(
        `使用批量翻译缓存结果 (文章ID: ${article.id}, 目标语言: ${targetLang})`,
      );
      return JSON.parse(cached.result);
    }

    // 获取源内容
    const getSourceContent = (field: string, localizedField: string) => {
      const articleAny = article;
      const localized = articleAny[localizedField];

      if (localized && localized[sourceLang]) {
        const value = localized[sourceLang];
        if (typeof value === 'string') return value;
        if (typeof value === 'object' && value !== null) {
          const firstValue = Object.values(value)[0];
          if (typeof firstValue === 'string') return firstValue;
        }
      }

      const fieldValue = articleAny[field];
      if (!fieldValue) return '';

      if (typeof fieldValue === 'object' && fieldValue !== null) {
        if (
          fieldValue[sourceLang] &&
          typeof fieldValue[sourceLang] === 'string'
        ) {
          return fieldValue[sourceLang];
        }
        const firstValue = Object.values(fieldValue)[0];
        if (typeof firstValue === 'string') return firstValue;
      }

      if (typeof fieldValue === 'string') return fieldValue;
      return '';
    };

    const sourceTitle =
      getSourceContent('title', 'titleLocalized') || article.title || '';
    const sourceContent =
      getSourceContent('contentMd', 'contentMdLocalized') ||
      getSourceContent('content', 'contentLocalized') ||
      article.content ||
      '';
    const sourceExcerpt =
      getSourceContent('excerpt', 'excerptLocalized') || article.excerpt || '';

    // 大内容保护：批量翻译将整篇文章放入单个请求体，超出限制会导致 Groq 413 等错误
    // 如果内容超过阈值，直接走传统翻译（translateMarkdown 内部会自动分块）
    const MAX_BATCH_CONTENT_CHARS = 50000; // ⬆️ 从30000提高到50000: DeepSeek 128K上下文，覆盖几乎所有文章
    if (sourceContent.length > MAX_BATCH_CONTENT_CHARS) {
      this.logger.debug(
        `文章内容过长 (${sourceContent.length} 字符)，跳过批量翻译直接使用分块翻译 (文章 ${article.id}，语言 ${targetLang})`,
      );
      return await this.fallbackToTraditionalTranslation(
        sourceTitle,
        sourceContent,
        sourceExcerpt,
        targetLang,
      );
    }

    // 构建批量翻译prompt
    // 使用分隔符格式替代JSON，避免Markdown内容中的特殊字符导致JSON解析失败
    const translationPrompt = `
Translate the following article to ${targetLang}. The source content is primarily Chinese but may contain mixed Chinese/English text, code blocks, and diagrams.

TITLE: ${sourceTitle}

EXCERPT: ${sourceExcerpt}

CONTENT (Markdown format):
${sourceContent}

IMPORTANT TECHNICAL TRANSLATION RULES:

TECHNICAL TERMS MUST REMAIN IN ENGLISH:
- Framework names: NestJS, Next.js, React, Vue, Angular, Express, FastAPI
- Database names: PostgreSQL, Redis, MongoDB, MySQL, SQLite, Prisma
- Programming languages: TypeScript, JavaScript, Python, Java, Go, Rust, C++
- Cloud services: Cloudflare, AWS, Google Cloud, Azure, Vercel, Netlify
- Tools & libraries: Docker, Kubernetes, Tailwind CSS, Shadcn UI, Webpack, Vite
- Technical concepts: Microservices, Monorepo, CI/CD, SSR, SPA, PWA, JAMstack
- Security terms: XSS, CSRF, SQL Injection, JWT, OAuth, OpenID, CORS, WAF, DDoS
- AI terms: LLM, Prompt Engineering, AI Moderation, Machine Learning, Deep Learning
- Abbreviations: API, HTML, CSS, REST, GraphQL, WebSocket, CLI, GUI, UI, UX
- Version control: Git, GitHub, GitLab, Bitbucket, SVN
- Operating systems: Linux, macOS, Windows, Android, iOS
- Protocols: HTTP, HTTPS, WebRTC, SMTP, IMAP, FTP, SSH

CRITICAL: Only the English term itself stays in English. The surrounding non-English text MUST be translated to the target language.
For example:
- "XSS攻击" (Chinese) -> "XSS攻撃" (Japanese), NOT "XSS攻击" (unchanged)
- "API设计" (Chinese) -> "APIデザイン" (Japanese), NOT "API设计" (unchanged)
- "JWT认证" (Chinese) -> "JWT認証" (Japanese), NOT "JWT认证" (unchanged)
- "SQL注入" (Chinese) -> "SQLインジェクション" (Japanese), NOT "SQL注入" (unchanged)

CRITICAL: CODE BLOCKS MUST BE PRESERVED VERBATIM.
Code blocks are enclosed in triple backticks (\`\`\`language ... \`\`\`).
- Do NOT translate anything inside code blocks (comments, variable names, string literals, function names).
- Do NOT modify code block formatting, indentation, or syntax.
- Code blocks often contain Dart, TypeScript, JavaScript, or other programming languages where comments may be in Chinese - leave them as-is inside the code block.
- Example: If a code block contains "// 主色阶梯", keep it exactly as "// 主色阶梯" inside the code block.

CRITICAL: ASCII / UNICODE DIAGRAMS MUST BE PRESERVED.
Diagrams use box-drawing characters (┌, ─, ┐, │, └, ┘, ├, ┤, ┬, ┴, ┼, →, ▼).
- Preserve the diagram layout and box-drawing characters exactly.
- If labels inside the diagram are in Chinese, translate them but do NOT break the diagram alignment.
- Keep label lengths as close to the original as possible to preserve layout.
- Example: If a diagram has "│  初始状态  │", translate the label but keep the box structure: "│  Initial  │".

CRITICAL: Every Chinese word/phrase MUST be translated. NO Chinese characters allowed in the output.
For example:
- "前端开发" (Chinese) -> "Frontend Development" (English) / "フロントエンド開発" (Japanese) / "프론트엔드 개발" (Korean)
- "安全防护" (Chinese) -> "Security Protection" (English) / "セキュリティ対策" (Japanese) / "보안 보호" (Korean)
- "后端开发" (Chinese) -> "Backend Development" (English) / "バックエンド開発" (Japanese) / "백엔드 개발" (Korean)
- "实战项目" (Chinese) -> "Practical Project" (English) / "実践プロジェクト" (Japanese) / "실전 프로젝트" (Korean)
- "AC自动机" (Chinese) -> "AC Automaton" (English) / "ACオートマトン" (Japanese) / "AC 오토마톤" (Korean)
- "敏感词过滤" (Chinese) -> "Sensitive Word Filtering" (English) / "機密語フィルタリング" (Japanese) / "민감어 필터링" (Korean)

CRITICAL: ALL THREE FIELDS (---TITLE---, ---EXCERPT---, ---CONTENT---) MUST BE TRANSLATED to ${targetLang}.
The TITLE and EXCERPT are NOT metadata or labels — they are article content that MUST be translated.
Even if the title or excerpt is very short (2-3 characters), it MUST be translated to the target language.
Do NOT leave any source language text in ---TITLE--- or ---EXCERPT--- or ---CONTENT---.

1. Keep all technical terms in English (NestJS, React, etc.)
2. Maintain the original Markdown formatting
3. Preserve all code blocks verbatim
4. Preserve all ASCII diagram structure
5. Return the translation using the following delimiter format (do NOT use JSON):

---TITLE---
Translated title here
---EXCERPT---
Translated excerpt here
---CONTENT---
Translated content in Markdown here

IMPORTANT: Return ONLY the three sections above with the exact delimiters. Do NOT add any other text, commentary, or formatting. The content section can contain any Markdown including code blocks, quotes, and special characters - just put it as-is between the delimiters.
`;

    let lastError: any;
    const maxRetries = 2;

    // Bug 3 fix: if AI is already unavailable, skip the 3-attempt loop immediately
    if (!this.aiService.isAvailable()) {
      this.logger.warn(
        `AI服务不可用，跳过批量翻译，回退到传统翻译（文章 ${article.id}，语言 ${targetLang}）`,
      );
      return await this.fallbackToTraditionalTranslation(
        sourceTitle,
        sourceContent,
        sourceExcerpt,
        targetLang,
      );
    }

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // 如果不是第一次尝试，先等待（速率限制退避 + 频率控制延迟）
        if (attempt > 0) {
          await this.handleRateLimit(attempt - 1, lastError);
          await this.delayBetweenRequests();
        }

        const result = await this.aiService.generateText(
          translationPrompt,
          {
            temperature: 0.3,
            maxOutputTokens: 8192,
            // 不使用 responseMimeType: 'application/json'，因为Markdown内容中的特殊字符会导致JSON解析失败
            // 改用分隔符格式（---TITLE---/---EXCERPT---/---CONTENT---），AI直接返回原始文本
          },
          AiServiceLevel.FULL,
        );

        // 确保result不是null或undefined
        if (!result) {
          throw new Error('AI service returned empty result');
        }

        // 使用分隔符解析翻译结果（替代JSON解析）
        try {
          const parsed = this.parseDelimitedTranslation(result);

          // 验证必需字段
          if (!parsed.title || !parsed.content) {
            throw new Error('Missing required fields in translation result');
          }

          const batchResult = {
            title: parsed.title.trim(),
            content: parsed.content.trim(),
            excerpt: parsed.excerpt ? parsed.excerpt.trim() : null,
          };

          // 缓存结果
          this.translationCache.set(cacheKey, {
            result: JSON.stringify(batchResult),
            timestamp: Date.now(),
          });

          return batchResult;
        } catch (parseError) {
          const errorMsg =
            parseError instanceof Error
              ? parseError.message
              : 'Unknown parse error';

          this.logger.error(
            `批量翻译分隔符解析失败 (尝试 ${attempt + 1}/${maxRetries + 1})`,
            {
              error: errorMsg,
              resultPreview: result ? result.substring(0, 500) : 'Empty result',
            },
          );

          // 如果是最后一次尝试，回退到传统方法
          if (attempt === maxRetries) {
            this.logger.warn('批量翻译失败，回退到传统翻译方法');
            return await this.fallbackToTraditionalTranslation(
              sourceTitle,
              sourceContent,
              sourceExcerpt,
              targetLang,
            );
          }
        }
      } catch (error) {
        lastError = error;

        // === Key 耗尽检测：generateText 返回 null（strict 模式） ===
        // batchTranslateArticle() 直接调用 generateText()，返回 null 时抛出
        // "AI service returned empty result"，不经过 translateText() 的
        // "AI returned null" 路径。所以要同时检测两种错误消息。
        const isKeysExhausted =
          error instanceof Error &&
          (error.message.includes('AI service returned empty result') ||
            error.message.includes('AI returned null'));

        if (isKeysExhausted) {
          const waitMs = 120000; // 2分钟
          this.logger.warn(
            `⚠️ Groq API 所有 Key 已暂时耗尽，等待 ${waitMs / 1000}s 后自动重试...`,
            { attempt: attempt + 1, maxRetries: maxRetries + 1, targetLang },
          );
          await new Promise((resolve) => setTimeout(resolve, waitMs));

          // 如果不是最后一次尝试，继续重试（不回退到传统翻译）
          if (attempt < maxRetries) {
            continue;
          }

          // 最后一次尝试也耗尽 → 回退到传统翻译
          this.logger.warn(
            `⌛ 批量翻译等待超时：所有 Groq Key 仍不可用（语言 ${targetLang}），回退到传统翻译方法`,
          );
          return await this.fallbackToTraditionalTranslation(
            sourceTitle,
            sourceContent,
            sourceExcerpt,
            targetLang,
          );
        }
        // === Key 耗尽检测结束 ===

        this.logger.error(
          `批量翻译失败 (尝试 ${attempt + 1}/${maxRetries + 1})`,
          {
            error: error instanceof Error ? error.message : 'Unknown error',
            articleId: article.id,
            targetLang,
          },
        );

        // 如果是最后一次尝试，或 AI 已不可用，回退到传统方法
        if (attempt === maxRetries || !this.aiService.isAvailable()) {
          this.logger.warn('批量翻译失败，回退到传统翻译方法');
          return await this.fallbackToTraditionalTranslation(
            sourceTitle,
            sourceContent,
            sourceExcerpt,
            targetLang,
          );
        }
      }
    }

    // 理论上不会执行到这里
    return await this.fallbackToTraditionalTranslation(
      sourceTitle,
      sourceContent,
      sourceExcerpt,
      targetLang,
    );
  }

  /**
   * 解析分隔符格式的翻译结果
   * AI返回格式：
   * ---TITLE---
   * Translated title
   * ---EXCERPT---
   * Translated excerpt
   * ---CONTENT---
   * Translated content in Markdown
   */
  private parseDelimitedTranslation(raw: string): {
    title: string;
    content: string;
    excerpt: string | null;
  } {
    // 尝试提取 ---TITLE--- 和 ---EXCERPT--- 和 ---CONTENT--- 之间的内容
    const titleMatch = raw.match(/---TITLE---\s*([\s\S]*?)\s*---EXCERPT---/);
    const excerptMatch = raw.match(
      /---EXCERPT---\s*([\s\S]*?)\s*---CONTENT---/,
    );
    const contentMatch = raw.match(/---CONTENT---\s*([\s\S]*)$/);

    if (!titleMatch) {
      throw new Error('无法找到 ---TITLE--- 分隔符');
    }
    if (!contentMatch) {
      throw new Error('无法找到 ---CONTENT--- 分隔符');
    }

    const title = titleMatch[1].trim();
    const content = contentMatch[1].trim();
    const excerpt = excerptMatch ? excerptMatch[1].trim() : null;

    if (!title) {
      throw new Error('翻译结果中标题为空');
    }
    if (!content) {
      throw new Error('翻译结果中内容为空');
    }

    return { title, content, excerpt };
  }

  /**
   * 回退到传统翻译方法
   */
  private async fallbackToTraditionalTranslation(
    title: string,
    content: string,
    excerpt: string,
    targetLang: string,
  ): Promise<{ title: string; content: string; excerpt: string | null }> {
    this.logger.debug('使用传统翻译方法');

    // 在每次独立翻译调用之间添加延迟，避免12个请求在短时间内爆发
    const titleTranslated = await this.translateWithRetry(
      title,
      targetLang,
      2,
      false,
    );

    await this.delayBetweenRequests();
    const contentTranslated = await this.translateWithRetry(
      content,
      targetLang,
      2,
      true,
    );

    let excerptTranslated = null;
    if (excerpt && excerpt.trim().length > 0) {
      await this.delayBetweenRequests();
      excerptTranslated = await this.translateWithRetry(
        excerpt,
        targetLang,
        2,
        false,
      );
    }

    return {
      title: titleTranslated,
      content: contentTranslated,
      excerpt: excerptTranslated,
    };
  }

  /**
   * 生成默认回复
   */
  private generateDefaultReply(
    commentContent: string,
    articleTitle?: string,
  ): string {
    // 简单的默认回复模板
    const templates = [
      `感谢你的评论！${articleTitle ? '关于"' + articleTitle + '"' : '这个问题'}，我会继续分享更多相关内容。`,
      `谢谢你的反馈！${articleTitle ? '在"' + articleTitle + '"中' : '在这里'}，我尝试用简单的方式解释复杂的概念。`,
      `很高兴看到你的评论！${articleTitle ? '关于"' + articleTitle + '"' : '这个话题'}，你有什么具体想了解的吗？`,
      `感谢参与讨论！${articleTitle ? '在"' + articleTitle + '"文章' : '这里'}，我尽量让内容更易懂。`,
      `谢谢你的问题！${articleTitle ? '关于"' + articleTitle + '"' : '这个主题'}，我会考虑写更多相关内容。`,
    ];

    // 根据评论内容选择不同的回复模板
    const commentLower = commentContent.toLowerCase();
    if (
      commentLower.includes('学习') ||
      commentLower.includes('看不明白') ||
      commentLower.includes('不懂')
    ) {
      return `学习是一个持续的过程！${articleTitle ? '关于"' + articleTitle + '"' : '这个主题'}，我建议从基础开始，逐步深入。有什么具体困惑可以告诉我吗？`;
    }
    if (commentLower.includes('谢谢') || commentLower.includes('感谢')) {
      return `不客气！${articleTitle ? '很高兴"' + articleTitle + '"对你有帮助。' : '很高兴对你有帮助。'}有什么其他想了解的吗？`;
    }
    if (commentLower.includes('问题') || commentLower.includes('疑问')) {
      return `好问题！${articleTitle ? '关于"' + articleTitle + '"' : '这个主题'}，我可以进一步解释。具体是哪个部分不清楚呢？`;
    }

    // 随机选择一个模板
    const randomIndex = Math.floor(Math.random() * templates.length);
    return templates[randomIndex];
  }

  /**
   * Markdown 渲染为 HTML
   */
  private renderMarkdown(md: string | null | undefined): string {
    if (!md) return '';
    return this.marked.parse(md) as string;
  }

  /**
   * Detect if text is already English (technical term / proper noun).
   * Returns true if text contains only ASCII printable characters
   * and at least one letter — meaning no CJK or accented characters.
   * This avoids wasting AI quota translating terms like "dio" → "dio".
   */
  private isEnglishText(text: string): boolean {
    if (!text || text.trim().length === 0) return false;
    // If text contains CJK characters (Chinese, Japanese, Korean), it's not English
    if (/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(text)) return false;
    // If text contains only ASCII printable characters and at least one letter, it's English
    return /^[\x20-\x7E]+$/.test(text.trim()) && /[a-zA-Z]/.test(text);
  }

  async process(job: Job): Promise<any> {
    switch (job.name) {
      case 'moderate-comment':
        return this.processCommentModeration(job, job.data);
      case 'auto-reply':
        return this.processAutoReply(job.data);
      case 'translate-article':
        return this.processArticleTranslation(job.data, job);
      case 'translate-category':
        return this.processCategoryTranslation(job.data, job);
      case 'translate-tag':
        return this.processTagTranslation(job.data, job);
      default:
        this.logger.warn(`Unknown job type: ${job.name}`);
    }
  }

  private async processCommentModeration(
    job: Job,
    data: {
      commentId: string;
      content: string;
      articleTitle?: string;
    },
  ) {
    this.logger.debug(
      `Processing AI moderation for comment: ${data.commentId}`,
    );

    try {
      // 首先获取评论详情，获取文章ID和作者信息
      const comment = await this.prisma.blogComment.findUnique({
        where: { id: data.commentId },
        select: {
          id: true,
          author: true,
          email: true,
          articleId: true,
        },
      });

      if (!comment) {
        this.logger.warn(`Comment ${data.commentId} not found`);
        return;
      }

      const result = await this.aiService.moderateComment(
        data.content,
        data.articleTitle,
      );

      // 更新评论审核结果
      await this.prisma.blogComment.update({
        where: { id: data.commentId },
        data: {
          aiModerationScore: result.score,
          aiModerationReason: result.reason,
          aiModerationCategories: (result.categories || []).join(','),
          aiModeratedAt: new Date(),
          status: result.passed
            ? CommentStatus.APPROVED
            : CommentStatus.REJECTED,
        },
      });

      // 如果审核通过且分数较低（安全友好的评论），生成自然的技术交流式自动回复
      if (result.passed && result.score < 30) {
        // 使用新的 AutoReplyService 管道生成自然回复
        // 分类 → 注入上下文 → 按类型选模板 → 生成 → 校验
        const replyContent = await this.aiService.generateAutoReply(
          data.content,
          comment.articleId,
          comment.author || undefined,
        );

        if (replyContent && replyContent.trim().length > 0) {
          await this.blogAiQueue.add(
            'auto-reply',
            {
              commentId: data.commentId,
              replyContent: replyContent,
              articleTitle: data.articleTitle,
            },
            {
              delay: 30000, // 30秒后自动回复，模拟真人延迟
            },
          );
          this.logger.debug(
            `Scheduled AI auto reply for comment: ${data.commentId}, score: ${result.score}`,
          );
        } else {
          this.logger.debug(
            `Auto-reply generation returned empty for comment: ${data.commentId}`,
          );
        }
      } else if (result.passed && result.score >= 30) {
        this.logger.debug(
          `评论审核通过但分数较高(${result.score})，不生成自动回复: ${data.commentId}`,
        );
      }

      this.logger.log(
        `AI moderation completed: comment ${data.commentId}, score ${result.score}, passed: ${result.passed}`,
      );
      return result;
    } catch (err) {
      this.logger.error(
        `AI moderation failed for comment ${data.commentId}`,
        err,
      );
      throw err;
    }
  }

  private async processAutoReply(data: {
    commentId: string;
    replyContent: string;
    articleTitle?: string;
  }) {
    this.logger.debug(
      `Generating AI auto reply for comment: ${data.commentId}`,
    );

    try {
      const comment = await this.prisma.blogComment.findUnique({
        where: { id: data.commentId },
      });

      if (!comment || comment.status !== CommentStatus.APPROVED) {
        this.logger.debug(
          `Comment ${data.commentId} not approved, skipping auto reply`,
        );
        return;
      }

      // 创建AI自动回复 - 使用脱敏名称"Porter"
      await this.prisma.blogComment.create({
        data: {
          articleId: comment.articleId,
          parentId: comment.id,
          author: 'Porter',
          email: 'porter@joyminis.com',
          content: data.replyContent,
          status: CommentStatus.APPROVED,
          isAiGenerated: true,
        },
      });

      // 异步更新评论计数
      this.prisma.blogArticle
        .update({
          where: { id: comment.articleId },
          data: { commentCount: { increment: 1 } },
        })
        .catch(() => {});

      this.logger.log(`AI auto reply created for comment ${data.commentId}`);
    } catch (err) {
      this.logger.error(
        `AI auto reply failed for comment ${data.commentId}`,
        err,
      );
      throw err;
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`Job ${job.id} failed: ${err.message}`);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.debug(`Job ${job.id} completed successfully`);
  }

  private async processArticleTranslation(
    data: {
      articleId: string;
      targetLang: string;
      sourceLang?: string;
    },
    job: Job,
  ) {
    // Fast-fail: check AI service budget before processing
    if (this.aiService.getServiceLevel() === AiServiceLevel.DISABLED) {
      this.logger.warn(
        `Skipping article translation (${data.articleId} → ${data.targetLang}): AI service disabled (daily budget exceeded)`,
      );
      return;
    }

    this.logger.debug(
      `Translating article: ${data.articleId} to ${data.targetLang}`,
    );

    // 更新 BullMQ 实时进度
    await job.updateProgress(1);

    // 创建/更新翻译任务记录
    const dbJobId = await this.translationJobService.createJob(
      'article',
      data.articleId,
      data.targetLang,
    );

    try {
      // 标记翻译中状态
      await this.translationJobService.updateProgress(dbJobId, 0, 'PROCESSING');
      await job.updateProgress(2);
      await this.prisma.blogArticle.update({
        where: { id: data.articleId },
        data: {
          translationStatus: 'TRANSLATING',
        },
      });

      // 进度 5% - 读取文章数据
      await this.translationJobService.updateProgress(dbJobId, 5);
      await job.updateProgress(5);

      const article = await this.prisma.blogArticle.findUnique({
        where: { id: data.articleId },
      });

      if (!article) {
        this.logger.warn(`Article ${data.articleId} not found`);
        return;
      }

      // 获取源语言（兼容历史作业没有sourceLang字段的情况）
      const sourceLang = data.sourceLang || 'zh';

      // 从Localized字段获取源语言内容，如果不存在则使用原始字段
      // 修复：正确处理JSON对象，提取字符串值
      const getSourceContent = (field: string, localizedField: string) => {
        const articleAny = article as any;
        const localized = articleAny[localizedField];

        // 1. 尝试从Localized字段获取
        if (localized && localized[sourceLang]) {
          const value = localized[sourceLang];
          // 如果是字符串，直接返回
          if (typeof value === 'string') return value;
          // 如果是对象，尝试提取字符串值
          if (typeof value === 'object' && value !== null) {
            // 处理嵌套错误格式：{ en: { zh: "..." } }
            const firstValue = Object.values(value)[0];
            if (typeof firstValue === 'string') return firstValue;
          }
        }

        // 2. 从原始字段获取
        const fieldValue = articleAny[field];
        if (!fieldValue) return '';

        // 3. 处理JSON对象字段
        if (typeof fieldValue === 'object' && fieldValue !== null) {
          // 从JSON对象中提取源语言值
          if (
            fieldValue[sourceLang] &&
            typeof fieldValue[sourceLang] === 'string'
          ) {
            return fieldValue[sourceLang];
          }
          // 如果没有源语言，尝试获取第一个字符串值
          const firstValue = Object.values(fieldValue)[0];
          if (typeof firstValue === 'string') return firstValue;
          // 如果第一个值也是对象，继续深入提取
          if (typeof firstValue === 'object' && firstValue !== null) {
            const deepValue = Object.values(firstValue)[0];
            if (typeof deepValue === 'string') return deepValue;
          }
        }

        // 4. 如果是字符串，直接返回
        if (typeof fieldValue === 'string') return fieldValue;

        // 5. 其他情况返回空字符串
        return '';
      };

      // 获取原始语言内容，确保总是有值（在翻译前获取，确保翻译和保存使用相同的内容）
      const sourceTitle =
        getSourceContent('title', 'titleLocalized') || article.title || '';
      const sourceContent =
        getSourceContent('contentMd', 'contentMdLocalized') ||
        getSourceContent('content', 'contentLocalized') ||
        article.content ||
        '';
      const sourceExcerpt =
        getSourceContent('excerpt', 'excerptLocalized') ||
        article.excerpt ||
        '';

      // 进度 10% - 准备完成，开始调用 AI 翻译
      await this.translationJobService.updateProgress(dbJobId, 10);

      // 使用批量翻译方法 - 将标题、摘要、正文合并为单个API请求
      // 这样可以避免碎片化请求导致的429错误
      const batchResult = await this.batchTranslateArticle(
        article,
        data.targetLang,
        sourceLang,
      );

      // 进度 70% - AI 返回翻译结果
      await this.translationJobService.updateProgress(dbJobId, 70);

      let titleTranslated = batchResult.title;
      const contentTranslated = batchResult.content;
      let excerptTranslated = batchResult.excerpt;

      // 验证翻译质量：逐字段检查，防止AI服务静默返回原文导致数据损坏
      // 策略变更：不再使用全有或全无策略，而是采用最佳努力逐字段处理
      // - 内容字段（最重要）：如果失败则整体失败，抛出错误
      // - 标题/摘要字段：尝试单独重译，失败则置空（保留已有翻译）
      const titleIsSame =
        titleTranslated === sourceTitle && sourceTitle.trim().length > 10;
      const contentIsSame =
        contentTranslated === sourceContent && sourceContent.trim().length > 50;
      const excerptIsSame =
        excerptTranslated === sourceExcerpt && sourceExcerpt.trim().length > 10;

      // 收集所有验证失败的字段描述
      const failedFields: string[] = [];
      if (titleIsSame) failedFields.push('标题');
      if (contentIsSame) failedFields.push('内容');
      if (excerptIsSame) failedFields.push('摘要');

      // 逐字段处理：内容失败 => 整体失败；标题/摘要失败 => 单独重译
      let retryTitleFailed = false;
      let retryExcerptFailed = false;

      if (failedFields.length > 0) {
        // 内容失败 => 整体失败（内容是最重要的字段，不能部分保存）
        if (contentIsSame) {
          this.logger.error(
            `翻译验证失败：内容字段返回原文（文章 ${data.articleId}，目标语言 ${data.targetLang}）`,
            { contentLength: sourceContent.length },
          );
          throw new Error(
            `翻译验证失败：AI返回内容与原文相同（${data.targetLang}）`,
          );
        }

        this.logger.warn(
          `翻译部分字段失败（文章 ${data.articleId}，目标语言 ${data.targetLang}），失败的字段: ${failedFields.join(', ')}，尝试单独重译`,
          { titleSame: titleIsSame, excerptSame: excerptIsSame },
        );

        // 标题单独重译
        if (titleIsSame) {
          try {
            const retriedTitle = await this.translateWithRetry(
              `Translate the following title to ${data.targetLang}. Return ONLY the translated text, no explanations:\n\n${sourceTitle}`,
              `retry-title-${data.articleId}-${data.targetLang}`,
            );
            if (retriedTitle && retriedTitle !== sourceTitle) {
              titleTranslated = retriedTitle;
              this.logger.log(
                `标题单独重译成功（文章 ${data.articleId}，目标语言 ${data.targetLang}）`,
              );
            } else {
              retryTitleFailed = true;
              this.logger.warn(
                `标题单独重译仍返回原文（文章 ${data.articleId}，目标语言 ${data.targetLang}）`,
              );
            }
          } catch (e) {
            retryTitleFailed = true;
            this.logger.warn(
              `标题单独重译失败（文章 ${data.articleId}，目标语言 ${data.targetLang}）`,
              e,
            );
          }
        }

        // 摘要单独重译
        if (excerptIsSame) {
          try {
            const retriedExcerpt = await this.translateWithRetry(
              `Translate the following excerpt to ${data.targetLang}. Return ONLY the translated text, no explanations:\n\n${sourceExcerpt}`,
              `retry-excerpt-${data.articleId}-${data.targetLang}`,
            );
            if (retriedExcerpt && retriedExcerpt !== sourceExcerpt) {
              excerptTranslated = retriedExcerpt;
              this.logger.log(
                `摘要单独重译成功（文章 ${data.articleId}，目标语言 ${data.targetLang}）`,
              );
            } else {
              retryExcerptFailed = true;
              this.logger.warn(
                `摘要单独重译仍返回原文（文章 ${data.articleId}，目标语言 ${data.targetLang}）`,
              );
            }
          } catch (e) {
            retryExcerptFailed = true;
            this.logger.warn(
              `摘要单独重译失败（文章 ${data.articleId}，目标语言 ${data.targetLang}）`,
              e,
            );
          }
        }
      }

      // 进度 80% - 保存翻译结果到数据库
      await this.translationJobService.updateProgress(dbJobId, 80);

      // 保存翻译结果到Localized JSON字段
      // 失败字段（重译后仍失败）将置空，保留之前已有的翻译值
      const updateData: any = {
        translationStatus:
          retryTitleFailed || retryExcerptFailed
            ? 'COMPLETED_WITH_WARNINGS'
            : 'COMPLETED',
        translatedAt: new Date(),
      };

      // 写入Localized多语言字段，同时保留原始语言内容
      // 对于重译失败的字段不写入 targetLang，避免用原文覆盖已有翻译
      updateData.titleLocalized = {
        ...((article.titleLocalized as any) || {}),
        [sourceLang]: sourceTitle || article.title || '', // 多重回退确保有值
        ...(!retryTitleFailed ? { [data.targetLang]: titleTranslated } : {}),
      };

      updateData.contentMdLocalized = {
        ...((article.contentMdLocalized as any) || {}),
        [sourceLang]:
          sourceContent || article.contentMd || article.content || '', // 多重回退
        [data.targetLang]: contentTranslated,
      };
      // 从原始内容中提取视频标签，用于追加到翻译后的内容中
      // AI 翻译只处理文本，视频嵌入标签会丢失
      const originalHtml = sourceContent || article.content || '';
      const videoTagRegex =
        /<figure[^>]*>[\s\S]*?<video[\s\S]*?<\/video>[\s\S]*?<\/figure>|<video[\s\S]*?<\/video>/gi;
      const preservedVideoTags = (originalHtml.match(videoTagRegex) || []).join(
        '\n',
      );

      // 自动渲染对应语言HTML
      // 注意：sourceContent 优先从 contentLocalized / contentMdLocalized 提取
      //       这确保了已保存的富文本内容（如视频）不会被旧 article.content 覆盖
      updateData.contentLocalized = {
        ...((article.contentLocalized as any) || {}),
        [sourceLang]:
          sourceLang === 'zh'
            ? ((article.contentLocalized as any)?.[sourceLang] as string) ||
              sourceContent ||
              article.content // 优先保留已有 HTML 内容（含视频），再回退到旧字段
            : this.renderMarkdown(sourceContent || article.content || ''), // 保留原始语言
        [data.targetLang]: (() => {
          const translatedHtml = this.renderMarkdown(contentTranslated);
          // 如果原始内容有视频标签，追加到翻译后的 HTML 末尾
          return preservedVideoTags
            ? translatedHtml + '\n' + preservedVideoTags
            : translatedHtml;
        })(),
      };

      updateData.excerptLocalized = {
        ...((article.excerptLocalized as any) || {}),
        [sourceLang]: sourceExcerpt || article.excerpt || '', // 确保有值
        ...(!retryExcerptFailed
          ? { [data.targetLang]: excerptTranslated }
          : {}),
      };

      await this.prisma.blogArticle.update({
        where: { id: data.articleId },
        data: updateData,
      });

      // 更新翻译任务为完成
      await this.translationJobService.updateProgress(
        dbJobId,
        100,
        'COMPLETED',
      );

      this.logger.log(`Article translation completed: ${data.articleId}`);
    } catch (err) {
      this.logger.error(
        `Article translation failed for ${data.articleId}`,
        err,
      );

      // 更新翻译任务为失败
      await this.translationJobService.updateProgress(
        dbJobId,
        0,
        'FAILED',
        err instanceof Error ? err.message : 'Unknown error',
      );

      // 识别OpenSSL兼容错误，这是环境配置问题，不是代码问题
      const isOpenSslError =
        err instanceof Error &&
        (err.message.includes('ERR_OSSL_UNSUPPORTED') ||
          err.message.includes('DECODER routines::unsupported'));
      if (isOpenSslError) {
        this.logger.warn(
          `Detected OpenSSL 3.0 compatibility error. Make sure NODE_OPTIONS=--openssl-legacy-provider is set for worker processes.`,
        );
      }

      await this.prisma.blogArticle
        .update({
          where: { id: data.articleId },
          data: {
            translationStatus: 'FAILED',
          },
        })
        .catch(() => {});

      // 不要重新抛出错误，避免队列无限重试
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        articleId: data.articleId,
      };
    }
  }

  private async processCategoryTranslation(
    data: {
      categoryId: string;
      targetLang: string;
      sourceLang?: string;
    },
    job: Job,
  ) {
    // Fast-fail: check AI service budget before processing
    if (this.aiService.getServiceLevel() === AiServiceLevel.DISABLED) {
      this.logger.warn(
        `Skipping category translation (${data.categoryId} → ${data.targetLang}): AI service disabled (daily budget exceeded)`,
      );
      return;
    }

    this.logger.debug(
      `Translating category: ${data.categoryId} to ${data.targetLang}`,
    );

    // 创建/更新翻译任务记录
    const dbJobId = await this.translationJobService.createJob(
      'category',
      data.categoryId,
      data.targetLang,
    );

    try {
      // 标记翻译中状态
      await this.translationJobService.updateProgress(dbJobId, 0, 'PROCESSING');

      // 进度 10% - 读取分类数据
      await this.translationJobService.updateProgress(dbJobId, 10);

      const category = await this.prisma.blogCategory.findUnique({
        where: { id: data.categoryId },
      });

      if (!category) {
        this.logger.warn(`Category ${data.categoryId} not found`);
        return;
      }

      // 获取源语言（兼容历史作业没有sourceLang字段的情况）
      const sourceLang = data.sourceLang || 'zh';

      // 从Localized字段获取源语言内容，如果不存在则使用原始字段
      // 修复：正确处理JSON对象，提取字符串值
      const getSourceContent = (field: string, localizedField: string) => {
        const categoryAny = category as any;
        const localized = categoryAny[localizedField];

        // 1. 尝试从Localized字段获取
        if (localized && localized[sourceLang]) {
          const value = localized[sourceLang];
          // 如果是字符串，直接返回
          if (typeof value === 'string') return value;
          // 如果是对象，尝试提取字符串值
          if (typeof value === 'object' && value !== null) {
            // 处理嵌套错误格式：{ en: { zh: "..." } }
            const firstValue = Object.values(value)[0];
            if (typeof firstValue === 'string') return firstValue;
          }
        }

        // 2. 从原始字段获取
        const fieldValue = categoryAny[field];
        if (!fieldValue) return '';

        // 3. 处理JSON对象字段
        if (typeof fieldValue === 'object' && fieldValue !== null) {
          // 从JSON对象中提取源语言值
          if (
            fieldValue[sourceLang] &&
            typeof fieldValue[sourceLang] === 'string'
          ) {
            return fieldValue[sourceLang];
          }
          // 如果没有源语言，尝试获取第一个字符串值
          const firstValue = Object.values(fieldValue)[0];
          if (typeof firstValue === 'string') return firstValue;
          // 如果第一个值也是对象，继续深入提取
          if (typeof firstValue === 'object' && firstValue !== null) {
            const deepValue = Object.values(firstValue)[0];
            if (typeof deepValue === 'string') return deepValue;
          }
        }

        // 4. 如果是字符串，直接返回
        if (typeof fieldValue === 'string') return fieldValue;

        // 5. 其他情况返回空字符串
        return '';
      };

      // 进度 20% - 准备完成，开始调用 AI 翻译名称
      await this.translationJobService.updateProgress(dbJobId, 20);

      // 执行翻译
      const nameSource = getSourceContent('name', 'nameLocalized');
      // 如果源内容已经是英文（技术术语/专有名词），直接复制到目标语言，跳过AI翻译
      let nameTranslated: string;
      if (this.isEnglishText(nameSource)) {
        this.logger.debug(
          `Category name "${nameSource}" is already English, copying directly to ${data.targetLang}`,
        );
        nameTranslated = nameSource;
      } else {
        nameTranslated = await this.aiService.translateText(
          nameSource,
          data.targetLang,
        );
      }

      // 进度 50% - 名称翻译完成，开始翻译描述
      await this.translationJobService.updateProgress(dbJobId, 50);

      const descriptionSource = getSourceContent(
        'description',
        'descriptionLocalized',
      );
      // 如果描述已经是英文，直接复制
      let descriptionTranslated: string;
      if (this.isEnglishText(descriptionSource)) {
        this.logger.debug(
          `Category description "${descriptionSource}" is already English, copying directly to ${data.targetLang}`,
        );
        descriptionTranslated = descriptionSource;
      } else {
        descriptionTranslated = await this.aiService.translateText(
          descriptionSource,
          data.targetLang,
        );
      }

      // 进度 80% - 翻译完成，保存到数据库
      await this.translationJobService.updateProgress(dbJobId, 80);

      // 保存翻译结果到Localized JSON字段
      const updateData: any = {};

      // 写入现有的name和description字段（已经是JSON类型）
      const categoryAny = category as any;
      updateData.name = {
        ...(categoryAny.name || {}),
        [data.targetLang]: nameTranslated,
      };

      updateData.description = {
        ...(categoryAny.description || {}),
        [data.targetLang]: descriptionTranslated,
      };

      await this.prisma.blogCategory.update({
        where: { id: data.categoryId },
        data: updateData,
      });

      // 更新翻译任务为完成
      await this.translationJobService.updateProgress(
        dbJobId,
        100,
        'COMPLETED',
      );

      this.logger.log(`Category translation completed: ${data.categoryId}`);
    } catch (err) {
      this.logger.error(
        `Category translation failed for ${data.categoryId}`,
        err,
      );

      // 更新翻译任务为失败
      await this.translationJobService.updateProgress(
        dbJobId,
        0,
        'FAILED',
        err instanceof Error ? err.message : 'Unknown error',
      );

      // 不要重新抛出错误，避免队列无限重试
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        categoryId: data.categoryId,
      };
    }
  }

  private async processTagTranslation(
    data: {
      tagId: string;
      targetLang: string;
      sourceLang?: string;
    },
    job: Job,
  ) {
    // Fast-fail: check AI service budget before processing
    if (this.aiService.getServiceLevel() === AiServiceLevel.DISABLED) {
      this.logger.warn(
        `Skipping tag translation (${data.tagId} → ${data.targetLang}): AI service disabled (daily budget exceeded)`,
      );
      return;
    }

    this.logger.debug(`Translating tag: ${data.tagId} to ${data.targetLang}`);

    // 创建/更新翻译任务记录
    const dbJobId = await this.translationJobService.createJob(
      'tag',
      data.tagId,
      data.targetLang,
    );

    try {
      // 标记翻译中状态
      await this.translationJobService.updateProgress(dbJobId, 0, 'PROCESSING');

      // 进度 10% - 读取标签数据
      await this.translationJobService.updateProgress(dbJobId, 10);

      const tag = await this.prisma.blogTag.findUnique({
        where: { id: data.tagId },
      });

      if (!tag) {
        this.logger.warn(`Tag ${data.tagId} not found`);
        return;
      }

      // 获取源语言（兼容历史作业没有sourceLang字段的情况）
      const sourceLang = data.sourceLang || 'zh';

      // 从Localized字段获取源语言内容，如果不存在则使用原始字段
      // 修复：正确处理JSON对象，提取字符串值
      const getSourceContent = (field: string, localizedField: string) => {
        const tagAny = tag as any;
        const localized = tagAny[localizedField];

        // 1. 尝试从Localized字段获取
        if (localized && localized[sourceLang]) {
          const value = localized[sourceLang];
          // 如果是字符串，直接返回
          if (typeof value === 'string') return value;
          // 如果是对象，尝试提取字符串值
          if (typeof value === 'object' && value !== null) {
            // 处理嵌套错误格式：{ en: { zh: "..." } }
            const firstValue = Object.values(value)[0];
            if (typeof firstValue === 'string') return firstValue;
          }
        }

        // 2. 从原始字段获取
        const fieldValue = tagAny[field];
        if (!fieldValue) return '';

        // 3. 处理JSON对象字段
        if (typeof fieldValue === 'object' && fieldValue !== null) {
          // 从JSON对象中提取源语言值
          if (
            fieldValue[sourceLang] &&
            typeof fieldValue[sourceLang] === 'string'
          ) {
            return fieldValue[sourceLang];
          }
          // 如果没有源语言，尝试获取第一个字符串值
          const firstValue = Object.values(fieldValue)[0];
          if (typeof firstValue === 'string') return firstValue;
          // 如果第一个值也是对象，继续深入提取
          if (typeof firstValue === 'object' && firstValue !== null) {
            const deepValue = Object.values(firstValue)[0];
            if (typeof deepValue === 'string') return deepValue;
          }
        }

        // 4. 如果是字符串，直接返回
        if (typeof fieldValue === 'string') return fieldValue;

        // 5. 其他情况返回空字符串
        return '';
      };

      // 进度 20% - 准备完成，开始调用 AI 翻译
      await this.translationJobService.updateProgress(dbJobId, 20);

      // 执行翻译
      const nameSource = getSourceContent('name', 'nameLocalized');
      // 如果源内容已经是英文（技术术语/专有名词），直接复制到目标语言，跳过AI翻译
      let nameTranslated: string;
      if (this.isEnglishText(nameSource)) {
        this.logger.debug(
          `Tag name "${nameSource}" is already English, copying directly to ${data.targetLang}`,
        );
        nameTranslated = nameSource;
      } else {
        nameTranslated = await this.aiService.translateText(
          nameSource,
          data.targetLang,
        );
      }

      // 进度 80% - 翻译完成，保存到数据库
      await this.translationJobService.updateProgress(dbJobId, 80);

      // 保存翻译结果到Localized JSON字段
      const updateData: any = {};

      // 写入现有的name字段（已经是JSON类型）
      const tagAny = tag as any;
      updateData.name = {
        ...(tagAny.name || {}),
        [data.targetLang]: nameTranslated,
      };

      await this.prisma.blogTag.update({
        where: { id: data.tagId },
        data: updateData,
      });

      // 更新翻译任务为完成
      await this.translationJobService.updateProgress(
        dbJobId,
        100,
        'COMPLETED',
      );

      this.logger.log(`Tag translation completed: ${data.tagId}`);
    } catch (err) {
      this.logger.error(`Tag translation failed for ${data.tagId}`, err);

      // 更新翻译任务为失败
      await this.translationJobService.updateProgress(
        dbJobId,
        0,
        'FAILED',
        err instanceof Error ? err.message : 'Unknown error',
      );

      // 不要重新抛出错误，避免队列无限重试
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        tagId: data.tagId,
      };
    }
  }
}
