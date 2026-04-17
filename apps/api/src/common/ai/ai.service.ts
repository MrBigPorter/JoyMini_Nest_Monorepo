import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GenerativeModel,
  HarmBlockThreshold,
  HarmCategory,
  VertexAI,
} from '@google-cloud/vertexai';

export interface AiModerationResult {
  score: number; // 0-100, 越高越危险
  passed: boolean;
  reason: string | null;
  categories: string[];
  autoReplySuggestion?: string;
}

export interface AiGenerationOptions {
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: string;
  systemPrompt?: string;
}

export enum AiServiceLevel {
  FULL = 3,
  ESSENTIAL = 2,
  MINIMAL = 1,
  DISABLED = 0,
}

@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger = new Logger(AiService.name);

  private vertexAI?: VertexAI;
  private geminiModel?: GenerativeModel;
  private isEnabled = false;

  // Article not found 用量监控 & 限流
  private usageCounter = {
    requests: 0,
    tokens: 0,
    resetAt: Date.now() + 60000,
  };

  // Article not found 服务等级 - 自动降级系统
  private serviceLevel = AiServiceLevel.FULL;
  private levelUpdatedAt = Date.now();

  // Article not found 熔断保护
  private circuitBreaker = {
    consecutiveFailures: 0,
    openUntil: 0,
    lastFailureAt: 0,
  };

  // Article not found Gemini 2.5 Flash 免费配额安全阈值 (预留20%缓冲)
  private readonly LIMITS = {
    RPM: 12, // 每分钟最多12次 (官方15)
    TPM: 800000, // 每分钟最多800k token (官方1M)
    DAILY: 800000, // 每天最多800k token (官方1M)
    FAILURE_THRESHOLD: 5, // 连续失败5次开启熔断
    CIRCUIT_BREAKER_DURATION: 900000, // 熔断15分钟
  };

  //  语言名称映射表 - 全局共享
  private readonly LANG_NAMES: Record<string, string> = {
    zh: 'Chinese',
    en: 'English',
    ja: 'Japanese',
    ko: 'Korean',
    fr: 'French',
    de: 'German',
  };

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    await this.initializeVertexAI();

    // 定时重置计数器
    setInterval(() => {
      this.resetCounters();
    }, 1000);
  }

  private resetCounters() {
    const now = Date.now();
    if (now >= this.usageCounter.resetAt) {
      this.usageCounter.requests = 0;
      this.usageCounter.tokens = 0;
      this.usageCounter.resetAt = now + 60000;
    }

    // 自动恢复服务等级 (每5分钟检查一次)
    if (
      now - this.levelUpdatedAt > 300000 &&
      this.serviceLevel < AiServiceLevel.FULL
    ) {
      this.serviceLevel = Math.min(this.serviceLevel + 1, AiServiceLevel.FULL);
      this.levelUpdatedAt = now;
      this.logger.log(
        `🔄 AI service level recovered to: ${AiServiceLevel[this.serviceLevel]}`,
      );
    }

    // 关闭熔断
    if (
      this.circuitBreaker.openUntil > 0 &&
      now >= this.circuitBreaker.openUntil
    ) {
      this.circuitBreaker.openUntil = 0;
      this.circuitBreaker.consecutiveFailures = 0;
      this.logger.log(
        'Article not found AI circuit breaker closed, service restored',
      );
    }
  }

  private async initializeVertexAI() {
    const googleCredsRaw = this.configService.get<string>(
      'GOOGLE_VISION_CREDENTIALS',
    );

    if (!googleCredsRaw) {
      this.logger.warn(
        'Google Vertex AI credentials not configured, AI service disabled',
      );
      return;
    }

    try {
      const credentials = JSON.parse(googleCredsRaw);

      const projectId =
        credentials.project_id || this.configService.get('GOOGLE_PROJECT_ID');

      if (projectId) {
        this.vertexAI = new VertexAI({
          project: projectId,
          location: 'us-central1',
          googleAuthOptions: { credentials },
        });

        // Article not found Gemini 2.5 Flash 版本 - 原生支持 Node 20+ OpenSSL 3.0
        this.geminiModel = this.vertexAI.getGenerativeModel({
          model: 'gemini-2.5-flash',
          safetySettings: [
            {
              category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
              threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
              category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
              threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
              category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
              threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
              category: HarmCategory.HARM_CATEGORY_HARASSMENT,
              threshold: HarmBlockThreshold.BLOCK_NONE,
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 2048,
          },
        });

        this.isEnabled = true;
        this.logger.log(
          `Article not found Vertex AI initialized with Gemini 2.5 Flash`,
        );
      }
    } catch (e) {
      this.logger.error('Failed to initialize Vertex AI', e);
    }
  }

  /**
   * Article not found 流量控制检查
   * 返回 true 表示允许请求
   */
  private checkRateLimit(estimatedTokens: number): boolean {
    // 熔断开启
    if (this.circuitBreaker.openUntil > Date.now()) {
      return false;
    }

    // 检查每分钟配额
    if (this.usageCounter.requests >= this.LIMITS.RPM) {
      if (this.serviceLevel > AiServiceLevel.ESSENTIAL) {
        this.serviceLevel = AiServiceLevel.ESSENTIAL;
        this.levelUpdatedAt = Date.now();
        this.logger.warn(`⚠️  RPM limit reached, downgraded to ESSENTIAL mode`);
      }
      return false;
    }

    if (this.usageCounter.tokens + estimatedTokens >= this.LIMITS.TPM) {
      if (this.serviceLevel > AiServiceLevel.MINIMAL) {
        this.serviceLevel = AiServiceLevel.MINIMAL;
        this.levelUpdatedAt = Date.now();
        this.logger.warn(`⚠️  TPM limit reached, downgraded to MINIMAL mode`);
      }
      return false;
    }

    return true;
  }

  private recordSuccess(tokens: number) {
    this.usageCounter.requests++;
    this.usageCounter.tokens += tokens;
    this.circuitBreaker.consecutiveFailures = 0;
  }

  private recordFailure() {
    this.circuitBreaker.consecutiveFailures++;
    this.circuitBreaker.lastFailureAt = Date.now();

    if (
      this.circuitBreaker.consecutiveFailures >= this.LIMITS.FAILURE_THRESHOLD
    ) {
      this.circuitBreaker.openUntil =
        Date.now() + this.LIMITS.CIRCUIT_BREAKER_DURATION;
      this.serviceLevel = AiServiceLevel.DISABLED;
      this.logger.error(
        `🔥 Circuit breaker OPENED for 15 minutes after ${this.LIMITS.FAILURE_THRESHOLD} consecutive failures`,
      );
    }
  }

  /**
   * 通用文本生成接口 - 所有AI功能的统一入口
   */
  async generateText(
    prompt: string,
    options?: AiGenerationOptions,
    requiredLevel: AiServiceLevel = AiServiceLevel.FULL,
  ): Promise<string | null> {
    if (!this.isEnabled || !this.geminiModel) {
      return null;
    }

    // 服务等级检查
    if (this.serviceLevel < requiredLevel) {
      return null;
    }

    // 流量控制检查
    const estimatedTokens =
      Math.ceil(prompt.length / 4) + (options?.maxOutputTokens || 512);
    if (!this.checkRateLimit(estimatedTokens)) {
      return null;
    }

    try {
      const result = await this.geminiModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: options,
      });

      const response = await result.response;

      // 安全边界检查
      if (
        !response ||
        !response.candidates ||
        response.candidates.length === 0
      ) {
        this.recordFailure();
        return null;
      }

      this.recordSuccess(estimatedTokens);
      return response.candidates[0]?.content?.parts?.[0]?.text || null;
    } catch (e: any) {
      this.recordFailure();

      // 特殊处理429错误（资源耗尽）
      if (e.code === 429 || e.status === 'RESOURCE_EXHAUSTED') {
        this.logger.warn(
          `⚠️  Vertex AI API 429 Resource Exhausted. Downgrading service level.`,
        );

        // 立即降级服务等级
        if (this.serviceLevel > AiServiceLevel.MINIMAL) {
          this.serviceLevel = AiServiceLevel.MINIMAL;
          this.levelUpdatedAt = Date.now();
          this.logger.warn(
            `⚠️  Service downgraded to MINIMAL mode due to 429 error`,
          );
        }

        // 开启熔断保护
        this.circuitBreaker.openUntil = Date.now() + 300000; // 5分钟熔断
        this.logger.warn(
          `🔥 Circuit breaker OPENED for 5 minutes due to 429 error`,
        );
      }

      this.logger.error('AI generation error', e);
      return null;
    }
  }

  /**
   * 增强版文本生成接口 - 支持指数退避重试
   */
  async generateTextWithRetry(
    prompt: string,
    options?: AiGenerationOptions,
    requiredLevel: AiServiceLevel = AiServiceLevel.FULL,
    maxRetries: number = 2,
  ): Promise<string | null> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.generateText(prompt, options, requiredLevel);

        // 如果成功返回结果
        if (result !== null) {
          return result;
        }

        // 如果返回null但服务可用，可能是限流，等待后重试
        if (this.isAvailable() && attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // 指数退避：1秒、2秒、4秒
          this.logger.debug(
            `AI request limited, waiting ${delay}ms before retry (attempt ${attempt + 1}/${maxRetries})`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        return null;
      } catch (error: any) {
        // 如果是429错误，使用指数退避重试
        if (
          (error.code === 429 || error.status === 'RESOURCE_EXHAUSTED') &&
          attempt < maxRetries
        ) {
          const delay = Math.pow(2, attempt) * 2000; // 更长的退避：2秒、4秒、8秒
          this.logger.warn(
            `Vertex AI 429 error, waiting ${delay}ms before retry (attempt ${attempt + 1}/${maxRetries})`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        // 其他错误或达到最大重试次数
        this.logger.error(
          `AI generation failed after ${attempt + 1} attempts`,
          error,
        );
        return null;
      }
    }

    return null;
  }

  /**
   * 评论内容智能审核 - 等级 ESSENTIAL
   */
  async moderateComment(
    content: string,
    articleTitle?: string,
  ): Promise<AiModerationResult> {
    const prompt = `
Act as a professional content moderator. Analyze this comment and return ONLY a JSON object.

Comment content: "${content}"
${articleTitle ? `Article context: "${articleTitle}"` : ''}

CRITICAL LANGUAGE RULES:
1. DETECT the language of the comment content
2. Your autoReplySuggestion MUST be in the EXACT SAME LANGUAGE as the comment
3. If comment is in Chinese, reply in Chinese
4. If comment is in English, reply in English
5. If comment is in Japanese, reply in Japanese
6. If you cannot detect the language, use English as default

RULES:
1. Score from 0-100. 0=completely safe, 100=extremely dangerous
2. Categories: SPAM, ADVERTISEMENT, HATE, HARASSMENT, VIOLENCE, SEXUAL, POLITICAL, FRAUD, OTHER
3. passed = score < 50
4. If score < 30 also provide a friendly relevant auto reply suggestion (1-2 sentences)

Return JSON format:
{
  "score": number,
  "passed": boolean,
  "reason": string | null,
  "categories": string[],
  "autoReplySuggestion": string | null
}
`.trim();

    const response = await this.generateText(
      prompt,
      {
        temperature: 0,
        maxOutputTokens: 512,
        responseMimeType: 'application/json',
      },
      AiServiceLevel.ESSENTIAL,
    );

    if (!response) {
      return { score: 0, passed: true, reason: null, categories: [] };
    }

    try {
      const jsonStr = this.extractJsonObject(response);
      const parsed = JSON.parse(jsonStr);
      // 防御性编程：确保返回的数据符合接口契约
      return {
        score: typeof parsed.score === 'number' ? parsed.score : 0,
        passed: parsed.passed !== false, // 默认通过
        reason: typeof parsed.reason === 'string' ? parsed.reason : null,
        categories: Array.isArray(parsed.categories) ? parsed.categories : [],
        autoReplySuggestion:
          typeof parsed.autoReplySuggestion === 'string'
            ? parsed.autoReplySuggestion
            : null,
      };
    } catch (e) {
      this.logger.warn('Failed to parse moderation result', response);
      return { score: 0, passed: true, reason: null, categories: [] };
    }
  }

  /**
   * 生成自动回复 - 等级 FULL
   */
  async generateAutoReply(
    comment: string,
    articleTitle: string,
    articleContent?: string,
  ): Promise<string | null> {
    if (this.serviceLevel < AiServiceLevel.FULL) {
      return null;
    }

    const prompt = `
Act as a friendly blog community manager. Generate a natural, relevant reply to this comment.

Article title: "${articleTitle}"
${articleContent ? `Article content preview: "${articleContent.slice(0, 500)}"` : ''}
User comment: "${comment}"

RULES:
1. Keep reply 1-2 sentences long
2. Be natural and human-like, not robotic
3. Be friendly and encouraging
4. Reference the article or comment content
5. Do NOT mention that you are an AI
6. Respond in the same language as the comment
`.trim();

    return this.generateText(
      prompt,
      {
        temperature: 0.7,
        maxOutputTokens: 256,
      },
      AiServiceLevel.FULL,
    );
  }

  /**
   * ⏳ 预留：生成向量嵌入
   */
  async generateEmbedding(text: string): Promise<number[] | null> {
    this.logger.debug('Embedding generation requested, feature coming soon');
    return null;
  }

  /**
   * ⏳ 预留：语义搜索匹配
   */
  async semanticSearch(query: string, documents: string[]): Promise<number[]> {
    return [];
  }

  /**
   * 通用文本翻译 - 等级 FULL
   */
  async translateText(text: string, targetLang: string): Promise<string> {
    if (!this.isEnabled || this.serviceLevel < AiServiceLevel.FULL) {
      return text;
    }

    const langName = this.LANG_NAMES[targetLang] || targetLang;
    const prompt = `
Translate the following text to ${langName}.

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

GENERAL RULES:
1. Preserve ALL technical terms, proper nouns, brand names, and trademarks in English
2. Keep code syntax, function names, class names, and technical identifiers unchanged
3. If a term could be either technical or regular, prefer keeping it in English
4. Maintain the original tone, meaning, and intent
5. Do not add any explanations, notes, or extra text
6. Only return the translated text

Text to translate:
${text}
`.trim();

    const result = await this.generateText(
      prompt,
      {
        temperature: 0.1,
        maxOutputTokens: Math.max(512, text.length * 2),
      },
      AiServiceLevel.FULL,
    );

    return result || text;
  }

  /**
   * Markdown 文档翻译 - 等级 FULL
   */
  async translateMarkdown(
    markdown: string,
    targetLang: string,
  ): Promise<string> {
    if (!this.isEnabled || this.serviceLevel < AiServiceLevel.FULL) {
      return markdown;
    }

    const langName = this.LANG_NAMES[targetLang] || targetLang;

    const prompt = `
Translate the following Markdown document to ${langName}.

Requirements:
1. Preserve ALL Markdown formatting: headers, lists, code blocks, links, bold, italic
2. Do NOT translate code inside code blocks
3. Keep technical terms and proper nouns unchanged
4. Maintain original structure and formatting
5. Return only the translated Markdown

Document:
${markdown}
`.trim();

    const result = await this.generateText(
      prompt,
      {
        temperature: 0.1,
        maxOutputTokens: Math.max(2048, markdown.length * 3),
      },
      AiServiceLevel.FULL,
    );

    return result || markdown;
  }

  isAvailable(): boolean {
    return this.isEnabled && this.circuitBreaker.openUntil <= Date.now();
  }

  getServiceLevel(): AiServiceLevel {
    return this.serviceLevel;
  }

  getUsageStats() {
    return {
      requests: this.usageCounter.requests,
      tokens: this.usageCounter.tokens,
      resetIn: Math.max(0, this.usageCounter.resetAt - Date.now()),
      serviceLevel: AiServiceLevel[this.serviceLevel],
      circuitBreakerOpen: this.circuitBreaker.openUntil > Date.now(),
      consecutiveFailures: this.circuitBreaker.consecutiveFailures,
    };
  }

  private extractJsonObject(text: string): string {
    const cleaned = text.replace(/```json|```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    return start >= 0 && end > start ? cleaned.slice(start, end + 1) : '{}';
  }
}
