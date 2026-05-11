import {
  Processor,
  WorkerHost,
  OnWorkerEvent,
  InjectQueue,
} from '@nestjs/bullmq';
import { Marked } from 'marked';
import TurndownService from 'turndown';
import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Job, Queue } from 'bullmq';
import { AiService, AiServiceLevel } from '@api/common/ai/ai.service';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { TranslationJobService } from '../translation-job.service';
import { CommentStatus } from '@prisma/client';
import { repairJsonResponse } from '../utils/repair-json';
import {
  extractMediaAndReplaceWithPlaceholders,
  restoreMediaPlaceholders,
} from '../utils/media-placeholder';

@Processor('blog-ai', {
  concurrency: 5, // 并行处理5篇文章（DeepSeek 付费 API 无速率限制）
  limiter: {
    max: 100, // 提高到100: 适应5倍并发
    duration: 60000,
  },
})
export class BlogAiProcessor extends WorkerHost {
  private readonly logger = new Logger(BlogAiProcessor.name);
  private readonly marked: Marked;
  private readonly turndown: TurndownService;
  private readonly rateLimitDelayBase = 1000; // 1秒基础延迟
  private readonly rateLimitDelayMax = 30000; // 30秒最大延迟
  private readonly interRequestDelay = 20; // 20ms between API calls (reduced for higher throughput with DeepSeek paid API)
  private readonly translationCache = new Map<
    string,
    { result: string; timestamp: number }
  >();
  private readonly cacheTTL = 60 * 60 * 1000; // 1小时缓存时间

  constructor(
    private aiService: AiService,
    private prisma: PrismaService,
    private translationJobService: TranslationJobService,
    private eventEmitter: EventEmitter2,
    @InjectQueue('blog-ai') private blogAiQueue: Queue,
  ) {
    super();
    this.marked = new Marked({
      gfm: true,
      breaks: true,
    });
    this.turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      emDelimiter: '*',
    });
    // Quill 代码块兼容规则：turndown 默认只识别 <pre><code>，
    // 但 Quill 用 <pre class="ql-syntax">（无 <code> 子元素）。
    // 不加此规则时，代码块会被 turndown 输出为纯文本，翻译后代码块消失。
    // 这是兜底规则，用于 sourceContent 为空必须走 turndown 降级路径的极端情况。
    this.turndown.addRule('quillCodeBlock', {
      filter: (node) => {
        return (
          node.nodeName === 'PRE' &&
          typeof (node as any).className === 'string' &&
          (node as any).className.includes('ql-syntax')
        );
      },
      replacement: (_content, node) => {
        const lang = (node as any).getAttribute?.('data-language') || '';
        // 取 textContent 避免 turndown 对内容二次转义
        const code = ((node as any).textContent || '').replace(/\r\n/g, '\n');
        return `\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
      },
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
   * 清除指定文章的翻译缓存。
   * 在用户清除翻译时调用，确保下次编辑保存后重新调用 AI 翻译，而不是返回旧缓存结果。
   */
  clearTranslationCache(articleId: string): void {
    const batchKeyPattern = `batch-${articleId}-`;
    const retryKeyPattern = `retry-${articleId}-`;

    let clearedCount = 0;
    for (const key of this.translationCache.keys()) {
      if (key.startsWith(batchKeyPattern) || key.startsWith(retryKeyPattern)) {
        this.translationCache.delete(key);
        clearedCount++;
      }
    }

    if (clearedCount > 0) {
      this.logger.log(
        `已清除文章 ${articleId} 的 ${clearedCount} 个翻译缓存条目`,
      );
    }
  }

  /**
   * Simple string hash function for cache key versioning
   * Generates a short hash from content to detect changes
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16).substring(0, 8);
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
    contentOverride?: string,
  ): Promise<{ title: string; content: string; excerpt: string | null }> {
    // Include content hash in cache key so edited content gets a different key
    // This prevents stale cache from returning ⏸️VIDEO_N placeholders that don't match current mediaMap
    const contentHash = contentOverride
      ? this.simpleHash(contentOverride)
      : 'no-content';
    const cacheKey = `batch-${article.id}-${targetLang}-${contentHash}`;
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
      contentOverride ||
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
5. Preserve ALL Unicode placeholder markers (⏸️VIDEO_N, 🖼️IMG_N) exactly as-is — do NOT translate, remove, or modify them
6. Return the translation using the following delimiter format (do NOT use JSON):

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
   * 将媒体占位符（⏸️VIDEO_N, 🖼️IMG_N）注入到 Markdown 内容的正确位置。
   *
   * 问题背景：首次翻译含视频的新文章时，sourceContent（Markdown）没有视频标签，
   * 视频只存在于原始 Quill HTML 中。旧方案用 turndown 把整个 HTML 转 Markdown，
   * 会破坏 Quill 的 <pre class="ql-syntax"> 代码块（turndown 不识别该格式）。
   *
   * 新策略：以原始高质量 Markdown 为主体，通过以下算法把视频放到正确位置：
   * 1. 在 htmlWithPlaceholders 中找到每个占位符的位置
   * 2. 取该占位符之前的 HTML 片段，找最后一个 <hN> 标题
   * 3. 在 Markdown 中找到对应标题行，把占位符插入该行之后
   * 4. 找不到对应标题时，追加到 Markdown 末尾（兜底）
   *
   * @param markdown - 原始 Markdown 内容（不含媒体标签，保留代码块、标题等完整格式）
   * @param htmlWithPlaceholders - 原始 HTML（媒体已被 extractMediaAndReplaceWithPlaceholders 替换为占位符）
   * @param mediaMap - 占位符 → 原始媒体 HTML 的映射（用于枚举所有占位符）
   * @returns 插入了占位符的 Markdown（占位符在各自标题后独占一个段落）
   */
  private injectMediaPlaceholdersIntoMarkdown(
    markdown: string,
    htmlWithPlaceholders: string,
    mediaMap: Map<string, string>,
  ): string {
    if (!markdown || mediaMap.size === 0) return markdown;

    // 按索引顺序排列占位符（VIDEO_0, VIDEO_1 … 顺序与 HTML 中出现顺序一致）
    const placeholders = [...mediaMap.keys()].sort((a, b) => {
      const na = parseInt(a.match(/\d+$/)?.[0] ?? '0', 10);
      const nb = parseInt(b.match(/\d+$/)?.[0] ?? '0', 10);
      return na - nb;
    });

    let result = markdown;

    // 倒序处理：从最后一个占位符开始，确保前面的插入不影响后面的位置计算
    for (let i = placeholders.length - 1; i >= 0; i--) {
      const placeholder = placeholders[i];
      const placeholderIdx = htmlWithPlaceholders.indexOf(placeholder);

      if (placeholderIdx === -1) {
        // 占位符在 HTML 中没有找到（理论上不应发生），追加到末尾
        result = result.trimEnd() + '\n\n' + placeholder + '\n\n';
        this.logger.warn(
          `[媒体注入] ${placeholder} 在 htmlWithPlaceholders 中未找到，追加到末尾`,
        );
        continue;
      }

      // 取该占位符之前的 HTML 内容，从中找最后一个 <hN>…</hN> 标题
      const htmlBefore = htmlWithPlaceholders.substring(0, placeholderIdx);
      const headingRegex = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
      let lastHeading: { level: number; text: string } | null = null;
      let match: RegExpExecArray | null;
      while ((match = headingRegex.exec(htmlBefore)) !== null) {
        // 去掉标题内的内嵌 HTML 标签（如 <strong>、<em>），取纯文本
        const rawText = match[2].replace(/<[^>]+>/g, '').trim();
        if (rawText) {
          lastHeading = { level: parseInt(match[1], 10), text: rawText };
        }
      }

      let inserted = false;

      if (lastHeading) {
        // 在 Markdown 中找对应的标题行
        // 用"包含标题纯文本"的方式匹配（处理 Markdown 标题内可能有 **bold** 等格式的情况）
        const mdPrefix = '#'.repeat(lastHeading.level);
        const escapedText = lastHeading.text.replace(
          /[.*+?^${}()|[\]\\]/g,
          '\\$&',
        );
        const mdHeadingRegex = new RegExp(
          `^(${mdPrefix}\\s+.*?${escapedText}.*?)$`,
          'm',
        );
        const mdMatch = result.match(mdHeadingRegex);

        if (mdMatch && mdMatch.index !== undefined) {
          const insertAt = mdMatch.index + mdMatch[0].length;
          result =
            result.substring(0, insertAt) +
            '\n\n' +
            placeholder +
            '\n\n' +
            result.substring(insertAt);
          inserted = true;
          this.logger.debug(
            `[媒体注入] ${placeholder} → 插入标题 "${lastHeading.text}" (h${lastHeading.level}) 之后`,
          );
        } else {
          this.logger.warn(
            `[媒体注入] ${placeholder} 找不到 Markdown 中对应标题 "${lastHeading.text}" (h${lastHeading.level})，追加到末尾`,
          );
        }
      }

      if (!inserted) {
        // 找不到匹配标题 → 追加到 Markdown 末尾（兜底，宁可位置不完美也不丢视频）
        result = result.trimEnd() + '\n\n' + placeholder + '\n\n';
        this.logger.debug(
          `[媒体注入] ${placeholder} 兜底追加到末尾（无匹配标题或标题在 Markdown 中缺失）`,
        );
      }
    }

    // 清理连续多余空行
    return result.replace(/\n{3,}/g, '\n\n').trim();
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
          parentId: true,
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

      // 无论是否通过审核，都通过 SSE 推送审核结果（前端用于替代轮询）
      this.eventEmitter.emit('blog.comment.moderated', {
        commentId: comment.id,
        articleId: comment.articleId,
        status: result.passed ? 'approved' : 'rejected',
      });
      this.logger.log(
        `[SSE-EMIT] blog.comment.moderated: commentId=${comment.id}, status=${result.passed ? 'approved' : 'rejected'}`,
      );

      // 如果审核通过且是回复评论（有 parentId），立即通过 SSE 推送给前端
      if (result.passed && comment.parentId) {
        const ssePayload = {
          articleId: comment.articleId,
          parentId: comment.parentId,
          replyId: comment.id,
          content: data.content,
          author: comment.author || 'Anonymous',
          createdAt: new Date().toISOString(),
        };
        this.logger.log(
          `[SSE-EMIT] 审核通过的回复，准备 emit: ${JSON.stringify(ssePayload)}`,
        );
        const listenerCount = this.eventEmitter.listenerCount(
          'blog.comment.reply.created',
        );
        this.logger.log(`[SSE-EMIT] 当前监听器数: ${listenerCount}`);
        this.eventEmitter.emit('blog.comment.reply.created', ssePayload);
        this.logger.log(`[SSE-EMIT] emit 已发出`);
      } else {
        this.logger.debug(
          `[SSE-EMIT] 跳过 SSE emit: passed=${result.passed}, parentId=${comment.parentId ?? 'null(顶级评论)'}`,
        );
      }

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
      const reply = await this.prisma.blogComment.create({
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

      // 发送 SSE 事件通知前端有新回复
      const aiSsePayload = {
        articleId: comment.articleId,
        parentId: comment.id,
        replyId: reply.id,
        content: data.replyContent,
        author: 'Porter',
        createdAt: new Date().toISOString(),
      };
      this.logger.log(
        `[SSE-EMIT] AI auto reply emit: ${JSON.stringify(aiSsePayload)}, 监听器数: ${this.eventEmitter.listenerCount('blog.comment.reply.created')}`,
      );
      this.eventEmitter.emit('blog.comment.reply.created', aiSsePayload);

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

      // === PLACEHOLDER-BASED MEDIA PRESERVATION ===
      // Extract HTML media tags (<figure><video>, <img>) and replace with Unicode
      // placeholders BEFORE AI translation. This prevents AI from stripping/modifying
      // media tags — the industry-standard approach used by Crowdin, Lokalise, Phrase, etc.
      // After translation, placeholders are restored to original HTML.
      let mediaMap = new Map<string, string>();
      let sourceContentForAi = sourceContent;

      // Helper: truncate for logging
      const truncate = (s: string | null | undefined, max: number) =>
        s ? (s.length > max ? s.substring(0, max) + '...' : s) : '(empty)';

      // First try extracting media from sourceContent (Markdown may have video tags
      // from previous translation saves where videos were appended to end)
      let mediaResult = extractMediaAndReplaceWithPlaceholders(sourceContent);
      if (mediaResult.count > 0) {
        // sourceContent had media tags → placeholders are inline at original positions
        mediaMap = mediaResult.mediaMap;
        sourceContentForAi = mediaResult.text;
        // Normalize: ensure every placeholder is on its own line (standalone paragraph)
        // Prevents AI from treating inline placeholders as text corruption and removing them
        sourceContentForAi = sourceContentForAi
          .replace(/⏸️VIDEO_\d+/g, '\n\n$&\n\n')
          .replace(/🖼️IMG_\d+/g, '\n\n$&\n\n')
          .replace(/\n{3,}/g, '\n\n');
        this.logger.log(
          `[DIAG] 占位符提取: 从 sourceContent (${sourceContent.length}ch) 中找到 ${mediaResult.count} 个媒体元素，sourceContentForAi 长度=${sourceContentForAi.length}ch`,
        );
      } else {
        // First-time translation: sourceContent is pure Markdown without media tags.
        // Extract media from original HTML content (Quill editor output).
        // Replace media tags with placeholders INLINE in the HTML (keeping original positions),
        // then convert the result to Markdown via turndown.
        // This ensures placeholders appear at their CORRECT positions in the content,
        // surrounded by real text, so the AI will naturally preserve them during translation.
        const originalHtml =
          ((article as any).contentLocalized as any)?.[sourceLang] ||
          article.content ||
          '';
        const htmlMediaResult =
          extractMediaAndReplaceWithPlaceholders(originalHtml);
        if (htmlMediaResult.count > 0) {
          mediaMap = htmlMediaResult.mediaMap;

          if (sourceContent.trim()) {
            // ✅ 新策略（主路径）：以原始 Markdown 为主体，把占位符注入正确标题后。
            // 不再用 turndown 整体转换 HTML ——turndown 无法识别 Quill 的
            // <pre class="ql-syntax"> 格式，会把代码块输出为纯文本，导致代码块消失。
            sourceContentForAi = this.injectMediaPlaceholdersIntoMarkdown(
              sourceContent,
              htmlMediaResult.text,
              htmlMediaResult.mediaMap,
            );
            this.logger.log(
              `[DIAG] 占位符注入: 从 originalHtml 中找到 ${htmlMediaResult.count} 个媒体元素，` +
                `以 sourceContent 为 Markdown 主体注入占位符。` +
                `sourceContentForAi 长度=${sourceContentForAi.length}ch，` +
                `是否含⏸️=${sourceContentForAi.includes('⏸️')}`,
            );
          } else {
            // ⚠️ 降级路径（sourceContent 为空）：不得不用 turndown 从 HTML 转 Markdown。
            // 此时 Quill 代码块规则（构造函数中已注册）会把 <pre class="ql-syntax">
            // 转为 fenced code block，尽量减少代码块丢失。
            sourceContentForAi = this.turndown.turndown(htmlMediaResult.text);
            this.logger.log(
              `[DIAG] 占位符注入(降级): sourceContent 为空，改用 turndown 转换 ` +
                `originalHtml。sourceContentForAi 长度=${sourceContentForAi.length}ch，` +
                `是否含⏸️=${sourceContentForAi.includes('⏸️')}`,
            );
          }

          // 确保每个占位符独占一个段落（AI 更容易识别并原样保留）
          sourceContentForAi = sourceContentForAi
            .replace(/⏸️VIDEO_\d+/g, '\n\n$&\n\n')
            .replace(/🖼️IMG_\d+/g, '\n\n$&\n\n')
            .replace(/\n{3,}/g, '\n\n');
        } else {
          this.logger.log(
            `[DIAG] 占位符提取: sourceContent 和 originalHtml 均未找到媒体元素 (${sourceContent.length}ch)`,
          );
        }
      }

      // === DIAG: 记录 sourceContentForAi 的末尾 300 字符，验证占位符是否在预期位置 ===
      this.logger.log(
        `[DIAG] sourceContentForAi 概览: 长度=${sourceContentForAi.length}ch，mediaMap.size=${mediaMap.size}，末尾 300ch="${truncate(sourceContentForAi.slice(-300), 300)}"，是否含⏸️=${sourceContentForAi.includes('⏸️')}`,
      );

      // 进度 10% - 准备完成，开始调用 AI 翻译
      await this.translationJobService.updateProgress(dbJobId, 10);

      // === DIAG: 记录翻译路径选择 ===
      const willFallback = sourceContentForAi.length > 50000;
      this.logger.log(
        `[DIAG] 翻译路径选择: content长度=${sourceContentForAi.length}ch, 阈值=50000, ${willFallback ? '→ fallbackToTraditionalTranslation (分块翻译)' : '→ batchTranslateArticle (单次批量)'}`,
      );

      // 使用批量翻译方法 - 将标题、摘要、正文合并为单个API请求
      // 这样可以避免碎片化请求导致的429错误
      // Pass sourceContentForAi (with placeholders) to ensure AI never sees raw HTML media tags
      const batchResult = await this.batchTranslateArticle(
        article,
        data.targetLang,
        sourceLang,
        sourceContentForAi,
      );

      // 进度 70% - AI 返回翻译结果
      await this.translationJobService.updateProgress(dbJobId, 70);

      let titleTranslated = batchResult.title;
      const contentTranslated = batchResult.content;
      let excerptTranslated = batchResult.excerpt;

      // Restore media placeholders in translated content back to original HTML.
      // Step 1: Detect placeholders that the AI silently dropped (AI sometimes removes
      // Unicode emoji markers it considers "decorative" or "rendering artifacts").
      // For any dropped placeholder, append the original media HTML at the end as recovery
      // — video at wrong position is infinitely better than no video at all.
      let contentForRestore = contentTranslated;
      if (mediaMap.size > 0) {
        const droppedPlaceholders: string[] = [];
        for (const [placeholder, originalHtml] of mediaMap) {
          if (!contentTranslated.includes(placeholder)) {
            contentForRestore =
              contentForRestore.trimEnd() + '\n\n' + originalHtml;
            droppedPlaceholders.push(placeholder);
          }
        }
        if (droppedPlaceholders.length > 0) {
          this.logger.warn(
            `[DIAG] ⚠️ AI 丢弃了 ${droppedPlaceholders.length} 个占位符 ` +
              `(${droppedPlaceholders.join(', ')})，已将对应媒体 HTML 追加到末尾恢复。`,
          );
        }
      }

      // Step 2: Restore any remaining placeholders (that AI did keep) → original HTML
      const finalContent =
        mediaMap.size > 0
          ? restoreMediaPlaceholders(contentForRestore, mediaMap)
          : contentTranslated;

      // ==== DIAGNOSTIC LOG: 翻译前后内容对比 + 占位符完整性检查 ====
      this.logger.log(
        `[DIAG] 翻译对比 (文章 ${data.articleId} -> ${data.targetLang}):\n` +
          `  源标题[${sourceTitle.length}ch]: ${truncate(sourceTitle, 120)}\n` +
          `  译标题[${titleTranslated.length}ch]: ${truncate(titleTranslated, 120)}\n` +
          `  源摘要[${sourceExcerpt.length}ch]: ${truncate(sourceExcerpt, 120)}\n` +
          `  译摘要[${(excerptTranslated || '').length}ch]: ${truncate(excerptTranslated, 120)}\n` +
          `  源内容[${sourceContent.length}ch] → 译内容[${contentTranslated.length}ch]`,
      );

      // === DIAG: 检查 AI 对占位符的保留情况 ===
      // expectedCount = mediaMap 中的占位符总数（我们注入给 AI 的数量）
      // keptCount     = AI 翻译后 contentTranslated 中仍存在的占位符数量
      // AI 保留的占位符会被 restoreMediaPlaceholders 还原；
      // AI 丢弃的占位符已由上方 recovery 逻辑把原始 HTML 追加到末尾。
      const placeholderPattern = /⏸️VIDEO_\d+|🖼️IMG_\d+/g;
      const keptPlaceholderCount = (
        contentTranslated.match(placeholderPattern) || []
      ).length;
      const expectedPlaceholderCount = mediaMap.size;
      if (expectedPlaceholderCount > 0) {
        if (keptPlaceholderCount === expectedPlaceholderCount) {
          this.logger.log(
            `[DIAG] 占位符完整性: ✅ AI 保留了全部 ${keptPlaceholderCount}/${expectedPlaceholderCount} 个占位符，将在正确位置还原`,
          );
        } else {
          this.logger.warn(
            `[DIAG] ⚠️ AI 仅保留了 ${keptPlaceholderCount}/${expectedPlaceholderCount} 个占位符，` +
              `${expectedPlaceholderCount - keptPlaceholderCount} 个被丢弃（已通过 recovery 追加到末尾）。` +
              `contentTranslated 末尾 300ch="${truncate(contentTranslated.slice(-300), 300)}"`,
          );
        }
      }

      // === DIAG: 检查 finalContent 中是否有 <video> 标签 ===
      const videoTagCount = (finalContent.match(/<video/gi) || []).length;
      const imgTagCount = (finalContent.match(/<img/gi) || []).length;
      this.logger.log(
        `[DIAG] finalContent 媒体标签: ${videoTagCount} 个<video>, ${imgTagCount} 个<img>`,
      );
      // 如果有 mediaMap 但没有 video 标签，说明还原失败
      if (mediaMap.size > 0 && videoTagCount === 0 && imgTagCount === 0) {
        this.logger.warn(
          `[DIAG] ⚠️ 严重警告: mediaMap 有 ${mediaMap.size} 个条目，但 finalContent 中没有任何 <video> 或 <img> 标签！`,
        );
      }

      // 验证翻译质量：逐字段检查，防止AI服务静默返回原文导致数据损坏
      // 策略变更：不再使用全有或全无策略，而是采用最佳努力逐字段处理
      // - 内容字段（最重要）：如果失败则整体失败，抛出错误
      // - 标题/摘要字段：尝试单独重译，失败则置空（保留已有翻译）
      const titleIsSame =
        titleTranslated === sourceTitle && sourceTitle.trim().length > 10;
      const contentIsSame =
        contentTranslated === sourceContentForAi && sourceContentForAi.trim().length > 50;
      const excerptIsSame =
        excerptTranslated === sourceExcerpt && sourceExcerpt.trim().length > 10;

      if (titleIsSame || contentIsSame || excerptIsSame) {
        this.logger.warn(
          `[DIAG] 翻译结果与原文相同: ${[titleIsSame ? '标题' : '', contentIsSame ? '内容' : '', excerptIsSame ? '摘要' : ''].filter(Boolean).join(', ')}`,
        );
      }

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
          // 清除缓存，避免重试时又返回缓存的错误结果
          this.translationCache.delete(
            `batch-${data.articleId}-${data.targetLang}`,
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

      // === PLACEHOLDER-BASED MEDIA PRESERVATION ===
      // Media tags were extracted into Unicode placeholders BEFORE AI translation
      // (see placeholder extraction above), and restored to original HTML AFTER
      // translation (see `finalContent` above). The translated content already has
      // media tags at their original positions — no need for video extraction + append.
      // This replaces the old fragile approach that relied on:
      //   1. Extracting video tags from original HTML after translation
      //   2. Appending them at the END of translated content (wrong position)
      //   3. AI prompt instructing "preserve video tags" (unreliable)

      // === DIAG: 保存前最终确认 ===
      const finalVideoCount = (finalContent.match(/<video/gi) || []).length;
      const finalPlaceholderPattern = /⏸️VIDEO_\d+|🖼️IMG_\d+/g;
      const finalPlaceholderCount = (finalContent.match(finalPlaceholderPattern) || []).length;
      this.logger.log(
        `[DIAG] 保存前确认: contentMdLocalized[${data.targetLang}] 长度=${finalContent.length}ch, <video>=${finalVideoCount}, 残留占位符=${finalPlaceholderCount}, 末尾 200ch="${truncate(finalContent.slice(-200), 200)}"`,
      );

      // Build source Markdown content with media restored (for source language save)
      const sourceMediaRestored = mediaMap.size > 0
        ? restoreMediaPlaceholders(sourceContentForAi, mediaMap)
        : sourceContent;
      const sourceMarkdownWithVideos = sourceMediaRestored || article.contentMd || article.content || '';

      updateData.contentMdLocalized = {
        ...((article.contentMdLocalized as any) || {}),
        // Source language: Markdown content with media tags restored (fixes legacy data)
        [sourceLang]: sourceMarkdownWithVideos,
        // Target language: translated Markdown with media tags at original positions
        [data.targetLang]: finalContent || contentTranslated,
      };

      // Auto-render HTML for each language
      updateData.contentLocalized = {
        ...((article.contentLocalized as any) || {}),
        // Source language: prefer original article.content (Quill HTML with videos), fallback to rendered Markdown
        [sourceLang]:
          article.content || this.renderMarkdown(sourceMarkdownWithVideos),
        // Target language: render translated Markdown (already has media tags restored) to HTML
        [data.targetLang]: this.renderMarkdown(finalContent || contentTranslated),
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

      // 重新抛出错误，让 BullMQ 正确标记任务为失败并在队列 UI 中显示
      // 队列已配置 attempts: 3 + exponential backoff，不会无限重试
      throw err;
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

      // 重新抛出错误，让 BullMQ 正确标记任务为失败
      // 队列已配置 attempts: 3 + exponential backoff，不会无限重试
      throw err;
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

      // 重新抛出错误，让 BullMQ 正确标记任务为失败
      // 队列已配置 attempts: 3 + exponential backoff，不会无限重试
      throw err;
    }
  }
}
