import {
  Injectable,
  Logger,
  OnModuleInit,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeminiProvider } from './providers/gemini.provider';
import { GroqProvider } from './providers/groq.provider';
import { DeepSeekProvider } from './providers/deepseek.provider';
import { AutoReplyService } from './auto-reply/auto-reply.service';
import { SystemConfigService } from '@api/admin/system-config/system-config.service';
import {
  AiProviderInstance,
  AiProviderUsageStats,
} from './interfaces/ai-provider.interface';

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

  // Provider instances
  private providers: AiProviderInstance[] = [];

  // Per-minute usage monitoring & rate limiting (shared across all providers)
  private usageCounter = {
    requests: 0,
    tokens: 0,
    resetAt: Date.now() + 60000,
  };

  // Daily date tracking for midnight reset
  private currentDate = '';

  // Service level - auto degradation system
  private serviceLevel = AiServiceLevel.FULL;
  private levelUpdatedAt = Date.now();

  // Circuit breaker (for non-429 failures)
  private circuitBreaker = {
    consecutiveFailures: 0,
    openUntil: 0,
    lastFailureAt: 0,
  };

  // Shared limits
  private readonly LIMITS = {
    RPM: 12, // max 12 requests/min
    TPM: 800000, // max 800k tokens/min
    DAILY_PER_KEY: 800000, // max 800k tokens/day per key
    FAILURE_THRESHOLD: 10, // 10 consecutive real failures → open circuit breaker (raised from 5)
    CIRCUIT_BREAKER_DURATION: 300000, // circuit breaker 5min (reduced from 15min)
    KEY_429_COOLDOWN: 60000, // 60s cooldown for a key that got 429
  };

  // Language name mapping - shared globally
  private readonly LANG_NAMES: Record<string, string> = {
    zh: 'Chinese',
    en: 'English',
    ja: 'Japanese',
    ko: 'Korean',
    fr: 'French',
    de: 'German',
  };

  // Cached provider config to avoid DB reads on every request
  // strict: true = DB explicit config, no fallback; false = env auto-detected, fallback allowed
  private providerConfigCache: {
    provider: string;
    model: string;
    strict: boolean;
  } | null = null;
  private providerConfigCacheAt = 0;
  private readonly PROVIDER_CONFIG_TTL = 30000; // 30s cache TTL

  constructor(
    private configService: ConfigService,
    private geminiProvider: GeminiProvider,
    private groqProvider: GroqProvider,
    private deepSeekProvider: DeepSeekProvider,
    private systemConfigService: SystemConfigService,
    @Inject(forwardRef(() => AutoReplyService))
    private autoReplyService: AutoReplyService,
  ) {}

  async onModuleInit() {
    // Register providers (order matters: Gemini first as default)
    this.providers = [
      this.geminiProvider,
      this.groqProvider,
      this.deepSeekProvider,
    ];

    this.currentDate = new Date().toISOString().slice(0, 10);

    // Periodic counter reset
    setInterval(() => {
      this.resetCounters();
    }, 1000);
  }

  /**
   * Get provider config from cache (avoids DB read on every request)
   * Falls back to default (gemini) if not configured
   */
  private async getProviderConfig(): Promise<{
    provider: string;
    model: string;
    strict: boolean;
  }> {
    const now = Date.now();
    if (
      this.providerConfigCache &&
      now - this.providerConfigCacheAt < this.PROVIDER_CONFIG_TTL
    ) {
      return this.providerConfigCache;
    }

    try {
      // 1. Try to read from SystemConfig DB table (set by admin UI)
      const dbConfig = await this.systemConfigService.get<{
        provider: string;
        model: string;
      }>('AI_TRANSLATION_PROVIDER', {
        provider: '',
        model: '',
      });

      if (dbConfig && dbConfig.provider) {
        // User explicitly configured a provider → strict mode (no fallback)
        const config = { ...dbConfig, strict: true };
        this.providerConfigCache = config;
        this.providerConfigCacheAt = now;
        return config;
      }

      // 2. Fallback: detect available providers from env vars (not strict)
      // Priority: DeepSeek (paid, no rate limits) > Groq (free, heavy 429) > Gemini (last resort)
      const deepseekKey = this.configService.get<string>('DEEPSEEK_API_KEY');
      if (deepseekKey) {
        const deepseekConfig = {
          provider: 'deepseek',
          model: 'deepseek-chat',
          strict: false,
        };
        this.providerConfigCache = deepseekConfig;
        this.providerConfigCacheAt = now;
        return deepseekConfig;
      }

      const groqKey = this.configService.get<string>('GROQ_API_KEY');
      if (groqKey) {
        const groqConfig = {
          provider: 'groq',
          model: 'llama-3.3-70b-versatile',
          strict: false,
        };
        this.providerConfigCache = groqConfig;
        this.providerConfigCacheAt = now;
        return groqConfig;
      }

      // 3. Last resort: Gemini (free tier)
      const defaultConfig = {
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        strict: false,
      };
      this.providerConfigCache = defaultConfig;
      this.providerConfigCacheAt = now;
      return defaultConfig;
    } catch {
      return { provider: 'gemini', model: 'gemini-2.5-flash', strict: false };
    }
  }

  /**
   * Set provider config (called from controller when user updates via UI)
   */
  setProviderConfig(config: {
    provider: string;
    model: string;
    strict?: boolean;
  }): void {
    this.providerConfigCache = {
      provider: config.provider,
      model: config.model,
      strict: config.strict ?? true, // UI 手动设置默认为 strict
    };
    this.providerConfigCacheAt = Date.now();
  }

  /**
   * Get available providers with their models
   */
  getAvailableProviders(): {
    name: string;
    displayName: string;
    models: string[];
    available: boolean;
  }[] {
    return this.providers.map((p) => ({
      name: p.name,
      displayName: p.displayName,
      models: p.models,
      available: p.isAvailable(),
    }));
  }

  private resetCounters() {
    const now = Date.now();

    // Reset per-minute counters
    if (now >= this.usageCounter.resetAt) {
      this.usageCounter.requests = 0;
      this.usageCounter.tokens = 0;
      this.usageCounter.resetAt = now + 60000;
    }

    // Check for date change (midnight reset for ALL providers)
    const today = new Date().toISOString().slice(0, 10);
    if (this.currentDate !== today) {
      this.currentDate = today;

      // Reset all providers at midnight
      for (const provider of this.providers) {
        provider.resetDailyCounters();
      }

      // Also reset service level if it was disabled due to daily exhaustion
      if (this.serviceLevel === AiServiceLevel.DISABLED) {
        this.serviceLevel = AiServiceLevel.FULL;
        this.levelUpdatedAt = now;
      }

      this.logger.log(
        `📅 Daily counter reset for all ${this.providers.length} providers (${today})`,
      );
    }

    // Unblock keys that have cooled down from 429
    // Fix: delegate to each provider (provider.keys was always empty — dead code)
    for (const provider of this.providers) {
      provider.unblockExpiredKeys(now);
    }

    // Auto-recover service level (check every 5 minutes)
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

    // Close circuit breaker
    if (
      this.circuitBreaker.openUntil > 0 &&
      now >= this.circuitBreaker.openUntil
    ) {
      this.circuitBreaker.openUntil = 0;
      this.circuitBreaker.consecutiveFailures = 0;
      this.logger.log(`🔌 AI circuit breaker closed, service restored`);
    }
  }

  /**
   * Check shared pre-conditions before making any AI request
   */
  private checkPreConditions(
    requiredLevel: AiServiceLevel = AiServiceLevel.FULL,
    estimatedTokens: number = 512,
  ): boolean {
    // Circuit breaker open
    if (this.circuitBreaker.openUntil > Date.now()) {
      return false;
    }

    // Service level check
    if (this.serviceLevel < requiredLevel) {
      this.logger.warn(
        `Service level ${AiServiceLevel[this.serviceLevel]} (${this.serviceLevel}) < required ${AiServiceLevel[requiredLevel]} (${requiredLevel})`,
      );
      return false;
    }

    // Check per-minute request quota (shared across all providers)
    if (this.usageCounter.requests >= this.LIMITS.RPM) {
      if (this.serviceLevel > AiServiceLevel.ESSENTIAL) {
        this.serviceLevel = AiServiceLevel.ESSENTIAL;
        this.levelUpdatedAt = Date.now();
        this.logger.warn(`⚠️  RPM limit reached, downgraded to ESSENTIAL mode`);
      }
      return false;
    }

    // Check per-minute token quota (shared)
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

  private recordFailure(error?: any) {
    this.circuitBreaker.consecutiveFailures++;
    this.circuitBreaker.lastFailureAt = Date.now();

    // Circuit breaker for non-429 consecutive failures
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
   * Universal text generation interface — unified entry for all AI features
   * Routes to the configured provider with fallback
   */
  async generateText(
    prompt: string,
    options?: AiGenerationOptions,
    requiredLevel: AiServiceLevel = AiServiceLevel.FULL,
  ): Promise<string | null> {
    // Determine provider config first (need to know if DeepSeek)
    const config = await this.getProviderConfig();
    const isDeepSeek = config.provider === 'deepseek';

    // Calculate estimated tokens (used for pre-condition checks and recording)
    const estimatedTokens =
      Math.ceil(prompt.length / 4) + (options?.maxOutputTokens || 512);

    // [DeepSeek bypass] Paid DeepSeek API has no rate limits (no RPM/TPM limits).
    // Skip shared pre-conditions for DeepSeek to allow full-speed translation.
    // Other providers (Groq, Gemini) still protected by shared RPM/TPM limits.
    // Easy to revert: delete the `isDeepSeek` condition and restore normal flow.
    if (!isDeepSeek) {
      if (!this.checkPreConditions(requiredLevel, estimatedTokens)) {
        return null;
      }
    }

    const primaryProvider =
      this.providers.find((p) => p.name === config.provider) ||
      this.providers[0];
    const fallbackProviders = this.providers.filter(
      (p) => p.name !== config.provider,
    );

    // Set active model on primary provider
    if (config.model && primaryProvider.models.includes(config.model)) {
      primaryProvider.activeModel = config.model;
    }

    // Track whether at least one provider was actually invoked (has keys & is available).
    // Only real invocation failures should count toward the circuit breaker.
    // "Provider has no key configured" is a config issue, not a transient error.
    let anyProviderAttempted = false;

    // Try primary provider
    if (primaryProvider.isAvailable()) {
      anyProviderAttempted = true;
      const result = await primaryProvider.generateText(prompt, options);
      if (result !== null) {
        // [DeepSeek bypass] Don't count DeepSeek's usage toward shared counters,
        // preventing counter pollution when fallback providers are used.
        if (!isDeepSeek) {
          this.recordSuccess(estimatedTokens);
        }
        return result;
      }
    }

    // Strict mode: user explicitly configured a provider → do NOT fall back to others
    if (config.strict) {
      this.logger.warn(
        `⛔ [${primaryProvider.displayName}] strict mode: all keys exhausted, skip fallback`,
      );
      return null;
    }

    // Try fallback providers in order
    for (const fallback of fallbackProviders) {
      if (!fallback.isAvailable()) continue;
      anyProviderAttempted = true;

      const fallbackResult = await fallback.generateText(prompt, options);
      if (fallbackResult !== null) {
        this.recordSuccess(estimatedTokens);
        this.logger.log(
          `↪️ Fallback to ${fallback.displayName} succeeded after ${primaryProvider.displayName} failed`,
        );
        return fallbackResult;
      }
    }

    // All providers failed
    if (anyProviderAttempted) {
      // At least one provider was available and invoked but returned null — real failure
      this.recordFailure();
      this.logger.warn(`❌ All AI providers failed for generateText()`);
    } else {
      // No provider had usable keys — config/quota issue, do NOT open circuit breaker
      this.logger.warn(
        `⚠️ No AI providers available (no keys configured or all exhausted)`,
      );
    }
    return null;
  }

  /**
   * Enhanced text generation with exponential backoff retry
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

        if (result !== null) {
          return result;
        }

        if (this.isAvailable() && attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // exp backoff: 1s, 2s, 4s
          this.logger.debug(
            `AI request limited, waiting ${delay}ms before retry (attempt ${attempt + 1}/${maxRetries})`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        return null;
      } catch (error: any) {
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 2000; // longer backoff: 2s, 4s, 8s
          this.logger.warn(
            `AI error, waiting ${delay}ms before retry (attempt ${attempt + 1}/${maxRetries})`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

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
   * Generate content from image (for KYC OCR) — Gemini only (vision)
   */
  async generateContentFromImage(
    prompt: string,
    imageBuffer: Buffer,
    mimeType: string = 'image/jpeg',
  ): Promise<string | null> {
    if (this.serviceLevel < AiServiceLevel.FULL) {
      return null;
    }

    // Estimate: base64 image size ~ 4/3 of buffer size
    const estimatedTokens =
      Math.ceil(prompt.length / 4) +
      Math.ceil(imageBuffer.length / 3 / 4) +
      512;
    if (!this.checkPreConditions(AiServiceLevel.FULL, estimatedTokens)) {
      return null;
    }

    // Only Gemini supports image generation
    const geminiProvider = this.providers.find((p) => p.name === 'gemini') as
      | GeminiProvider
      | undefined;
    if (!geminiProvider || !geminiProvider.isAvailable()) {
      this.logger.warn(
        'generateContentFromImage() called but Gemini provider is not available',
      );
      return null;
    }

    const result = await geminiProvider.generateContentFromImage(
      prompt,
      imageBuffer,
      mimeType,
    );
    if (result !== null) {
      this.recordSuccess(estimatedTokens);
    }
    return result;
  }

  /**
   * Comment content moderation — level ESSENTIAL
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
      return {
        score: typeof parsed.score === 'number' ? parsed.score : 0,
        passed: parsed.passed !== false,
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
   * Generate auto reply — level FULL
   * Uses the new AutoReplyService pipeline:
   *   classify → enrich → build prompt → generate → validate
   */
  async generateAutoReply(
    comment: string,
    articleId: string,
    author?: string,
  ): Promise<string | null> {
    if (this.serviceLevel < AiServiceLevel.FULL) {
      return null;
    }

    const result = await this.autoReplyService.generateReply(
      comment,
      articleId,
      author,
    );

    return result.content || null;
  }

  /**
   * ⏳ Reserved: generate vector embeddings
   */
  generateEmbedding(text: string): Promise<number[] | null> {
    this.logger.debug('Embedding generation requested, feature coming soon');
    return Promise.resolve(null);
  }

  /**
   * ⏳ Reserved: semantic search matching
   */
  semanticSearch(query: string, documents: string[]): Promise<number[]> {
    return Promise.resolve([]);
  }

  /**
   * Universal text translation — level FULL
   */
  async translateText(text: string, targetLang: string): Promise<string> {
    if (this.serviceLevel < AiServiceLevel.FULL) {
      return text;
    }

    const langName = this.LANG_NAMES[targetLang] || targetLang;
    const prompt = `
Translate the following text to ${langName}.

IMPORTANT TECHNICAL TRANSLATION RULES:

TECHNICAL TERMS MUST REMAIN IN ENGLISH:
- Framework names: NestJS, Next.js, React, Vue, Angular, Express, FastAPI, BullMQ, Socket.io
- Database names: PostgreSQL, Redis, MongoDB, MySQL, SQLite, Prisma
- Programming languages & runtimes: TypeScript, JavaScript, Python, Java, Go, Rust, C++, Node.js, Bash
- Cloud services: Cloudflare, AWS, Google Cloud, Azure, Vercel, Netlify, DigitalOcean
- Tools & libraries: Docker, Kubernetes, Tailwind CSS, Shadcn UI, Webpack, Vite, Sentry, ESLint, Prettier, Yarn, Jest, Vitest, Husky, Playwright, Figma, Swagger, Zod, Nginx
- Technical concepts: Microservices, Monorepo, CI/CD, SSR, SPA, PWA, JAMstack, SEO, i18n, RBAC, IM (Instant Messaging), Fintech, Webhook
- Security terms: XSS, CSRF, SQL Injection, JWT, OAuth, OpenID, CORS, WAF, DDoS, reCAPTCHA, Rate Limiting, Device Fingerprinting
- AI terms: LLM, Prompt Engineering, AI Moderation, Machine Learning, Deep Learning, Gemini, Embedding, Vector Search
- Abbreviations: API, HTML, CSS, REST, GraphQL, WebSocket, CLI, GUI, UI, UX, ORM, SDK, CMS
- Payment & Fintech: Xendit, Stripe, PayPal, Alipay
- Version control: Git, GitHub, GitLab, Bitbucket, SVN, Gitea, Codeberg
- Operating systems: Linux, macOS, Windows, Android, iOS, Ubuntu, Debian, Alpine
- Protocols: HTTP, HTTPS, WebRTC, SMTP, IMAP, FTP, SSH, TCP/IP, UDP, DNS

CRITICAL: Only the English term itself stays in English. The surrounding non-English text MUST be translated to the target language.
For example:
- "XSS攻击" (Chinese) -> "XSS攻撃" (Japanese), NOT "XSS攻击" (unchanged)
- "API设计" (Chinese) -> "APIデザイン" (Japanese), NOT "API设计" (unchanged)
- "JWT认证" (Chinese) -> "JWT認証" (Japanese), NOT "JWT认证" (unchanged)
- "SQL注入" (Chinese) -> "SQLインジェクション" (Japanese), NOT "SQL注入" (unchanged)

CRITICAL: Every Chinese word/phrase MUST be translated. NO Chinese characters allowed in the output.
For example:
- "前端开发" (Chinese) -> "Frontend Development" (English) / "フロントエンド開発" (Japanese) / "프론트엔드 개발" (Korean)
- "安全防护" (Chinese) -> "Security Protection" (English) / "セキュリティ対策" (Japanese) / "보안 보호" (Korean)
- "后端开发" (Chinese) -> "Backend Development" (English) / "バックエンド開発" (Japanese) / "백엔드 개발" (Korean)
- "实战项目" (Chinese) -> "Practical Project" (English) / "実践プロジェクト" (Japanese) / "실전 프로젝트" (Korean)
- "AC自动机" (Chinese) -> "AC Automaton" (English) / "ACオートマトン" (Japanese) / "AC 오토마톤" (Korean)
- "敏感词过滤" (Chinese) -> "Sensitive Word Filtering" (English) / "機密語フィルタリング" (Japanese) / "민감어 필터링" (Korean)

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

    if (!result) {
      throw new Error(
        `Translation failed: AI returned null for target language "${targetLang}" (text length: ${text.length})`,
      );
    }
    return result;
  }

  /**
   * Markdown document translation — level FULL
   * Automatically chunks large documents to avoid 413 / context-limit errors.
   */
  async translateMarkdown(
    markdown: string,
    targetLang: string,
  ): Promise<string> {
    if (this.serviceLevel < AiServiceLevel.FULL) {
      return markdown;
    }

    // For large documents, split into sections and translate each one separately.
    // Threshold increased from 5000 to 20000 for DeepSeek (128K context window).
    // DeepSeek can handle much larger single calls, reducing chunk count.
    const MAX_SINGLE_CALL_CHARS = 20000;
    if (markdown.length > MAX_SINGLE_CALL_CHARS) {
      return this.translateMarkdownInChunks(markdown, targetLang);
    }

    return this.translateMarkdownSingle(markdown, targetLang);
  }

  /**
   * Translate a single Markdown chunk (≤ MAX_SINGLE_CALL_CHARS)
   */
  private async translateMarkdownSingle(
    markdown: string,
    targetLang: string,
  ): Promise<string> {
    const langName = this.LANG_NAMES[targetLang] || targetLang;

    const prompt = `
Translate the following Markdown document to ${langName}.

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

CRITICAL: Every Chinese word/phrase MUST be translated. NO Chinese characters allowed in the output.
For example:
- "前端开发" (Chinese) -> "Frontend Development" (English) / "フロントエンド開発" (Japanese) / "프론트엔드 개발" (Korean)
- "安全防护" (Chinese) -> "Security Protection" (English) / "セキュリティ対策" (Japanese) / "보안 보호" (Korean)
- "后端开发" (Chinese) -> "Backend Development" (English) / "バックエンド開発" (Japanese) / "백엔드 개발" (Korean)
- "实战项目" (Chinese) -> "Practical Project" (English) / "実践プロジェクト" (Japanese) / "실전 프로젝트" (Korean)
- "AC自动机" (Chinese) -> "AC Automaton" (English) / "ACオートマトン" (Japanese) / "AC 오토마톤" (Korean)
- "敏感词过滤" (Chinese) -> "Sensitive Word Filtering" (English) / "機密語フィルタリング" (Japanese) / "민감어 필터링" (Korean)

Requirements:
1. Preserve ALL Markdown formatting: headers, lists, code blocks, links, bold, italic
2. Do NOT translate code inside code blocks
3. Keep technical terms and proper nouns unchanged
4. Preserve ALL Unicode placeholder markers (⏸️VIDEO_N, 🖼️IMG_N) exactly as-is — do NOT translate, remove, or modify them
5. Maintain original structure and formatting
6. Return only the translated Markdown

Document:
${markdown}
`.trim();

    const result = await this.generateText(
      prompt,
      {
        temperature: 0.1,
        // ⬆️ 4096→8192: 大 chunk (up to 20000 chars) 的输出翻译可能更长
        // 8192 tokens ≈ 6000 words = ~48000 chars Latin, ~16000 chars CJK
        maxOutputTokens: Math.min(Math.max(2048, markdown.length * 2), 8192),
      },
      AiServiceLevel.FULL,
    );

    return result || markdown;
  }

  /**
   * Split large Markdown into header-based chunks, translate each, then rejoin.
   * Prevents 413 / context-limit errors on long articles.
   * Chunk size increased for DeepSeek (128K context window).
   */
  private async translateMarkdownInChunks(
    markdown: string,
    targetLang: string,
  ): Promise<string> {
    const MAX_CHUNK_CHARS = 20000; // ⬆️ 4000→20000: DeepSeek 128K上下文，减少分块数
    const chunks = this.splitMarkdownIntoChunks(markdown, MAX_CHUNK_CHARS);

    this.logger.debug(
      `大文档分块翻译: ${markdown.length} 字符 → ${chunks.length} 块 (目标语言: ${targetLang})`,
    );

    // === DIAG: 记录每个 chunk 的首尾字符，追踪占位符分布 ===
    const truncate = (s: string, max: number) =>
      s.length > max ? s.substring(0, max) + '...' : s;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const hasPlaceholder = chunk.includes('⏸️') || chunk.includes('🖼️');
      this.logger.log(
        `[DIAG] 分块翻译: chunk[${i + 1}/${chunks.length}] 长度=${chunk.length}ch, 含占位符=${hasPlaceholder}, 头部 100ch="${truncate(chunk.substring(0, 100), 100)}", 尾部 100ch="${truncate(chunk.substring(chunk.length - 100), 100)}"`,
      );
    }

    const translatedChunks: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const originalHasPlaceholder =
        chunk.includes('⏸️') || chunk.includes('🖼️');

      // Each chunk is ≤ MAX_CHUNK_CHARS, safe for single-call
      const translated = await this.translateMarkdownSingle(chunk, targetLang);
      translatedChunks.push(translated);

      // === DIAG: 检查翻译后 chunk 是否还保留占位符 ===
      const translatedHasPlaceholder =
        translated.includes('⏸️') || translated.includes('🖼️');
      if (originalHasPlaceholder && !translatedHasPlaceholder) {
        this.logger.warn(
          `[DIAG] ⚠️ 分块翻译 chunk[${i + 1}/${chunks.length}] 占位符丢失！原 chunk 尾部 200ch="${truncate(chunk.substring(chunk.length - 200), 200)}", 译 chunk 尾部 200ch="${truncate(translated.substring(translated.length - 200), 200)}"`,
        );
      } else if (originalHasPlaceholder) {
        this.logger.log(
          `[DIAG] 分块翻译: chunk[${i + 1}/${chunks.length}] 占位符 ✅ 保留`,
        );
      }

      // Small delay between chunks to prevent request bursts (DeepSeek has no rate limits)
      if (i < chunks.length - 1) {
        this.logger.debug(`分块翻译延迟 50ms (块 ${i + 1}/${chunks.length})`);
        await new Promise((resolve) => setTimeout(resolve, 50)); // ⬇️ 500ms→50ms: DeepSeek 无速率限制
      }
    }

    const result = translatedChunks.join('\n\n');

    // === DIAG: 最终结果检查 ===
    const resultHasPlaceholder = result.includes('⏸️') || result.includes('🖼️');
    this.logger.log(
      `[DIAG] 分块翻译完成: 合并后长度=${result.length}ch, 含占位符=${resultHasPlaceholder}, 尾部 200ch="${truncate(result.substring(result.length - 200), 200)}"`,
    );

    return result;
  }

  /**
   * Split Markdown into sections by H2/H3 headers.
   * If a section still exceeds maxChunkSize, further split by paragraphs.
   */
  private splitMarkdownIntoChunks(
    markdown: string,
    maxChunkSize: number,
  ): string[] {
    // Split at every H2/H3 heading (keeps the heading with its section)
    const sections = markdown.split(/(?=\n#{2,3} )/);

    const chunks: string[] = [];
    let current = '';

    for (const section of sections) {
      if (
        current.length > 0 &&
        current.length + section.length > maxChunkSize
      ) {
        chunks.push(current.trimEnd());
        current = section;
      } else {
        current += section;
      }
    }
    if (current.trim()) {
      chunks.push(current.trimEnd());
    }

    // If any section is still too large, split by paragraphs
    const finalChunks: string[] = [];
    for (const chunk of chunks) {
      if (chunk.length <= maxChunkSize) {
        finalChunks.push(chunk);
        continue;
      }

      const paragraphs = chunk.split(/\n{2,}/);
      let paraBuffer = '';
      for (const para of paragraphs) {
        if (
          paraBuffer.length > 0 &&
          paraBuffer.length + para.length + 2 > maxChunkSize
        ) {
          finalChunks.push(paraBuffer.trimEnd());
          paraBuffer = para;
        } else {
          paraBuffer += (paraBuffer ? '\n\n' : '') + para;
        }
      }
      if (paraBuffer.trim()) {
        finalChunks.push(paraBuffer.trimEnd());
      }
    }

    return finalChunks.length > 0 ? finalChunks : [markdown];
  }

  isAvailable(): boolean {
    return (
      this.providers.some((p) => p.isAvailable()) &&
      this.circuitBreaker.openUntil <= Date.now()
    );
  }

  getServiceLevel(): AiServiceLevel {
    return this.serviceLevel;
  }

  getUsageStats() {
    // Fix: provider.keys is always empty (providers use private keyInstances).
    // Use getUsageStats() directly for all providers that have been initialized.
    const providerStats = this.providers
      .map((p) => p.getUsageStats())
      .filter((s) => s.keys.length > 0);

    const totalDailyTokens = providerStats.reduce(
      (sum, p) => sum + p.keys.reduce((s, k) => s + k.dailyTokens, 0),
      0,
    );

    return {
      serviceLevel: AiServiceLevel[this.serviceLevel],
      serviceLevelValue: this.serviceLevel,
      available: this.isAvailable(),
      circuitBreaker: {
        open: this.circuitBreaker.openUntil > Date.now(),
        resetAfter: this.circuitBreaker.openUntil,
        consecutiveFailures: this.circuitBreaker.consecutiveFailures,
      },
      limits: {
        RPM: this.LIMITS.RPM,
        TPM: this.LIMITS.TPM,
        TPD: this.LIMITS.DAILY_PER_KEY,
      },
      providers: providerStats,
      total: {
        requests: this.usageCounter.requests,
        tokens: this.usageCounter.tokens,
        totalDailyTokens,
        resetIn: Math.max(0, this.usageCounter.resetAt - Date.now()),
      },
    };
  }

  private extractJsonObject(text: string): string {
    const cleaned = text.replace(/```json|```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    return start >= 0 && end > start ? cleaned.slice(start, end + 1) : '{}';
  }
}
