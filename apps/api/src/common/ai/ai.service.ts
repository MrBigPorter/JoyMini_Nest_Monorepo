import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GoogleGenerativeAI,
  GenerativeModel,
  HarmCategory,
  HarmBlockThreshold,
} from '@google/generative-ai';

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

interface GeminiKeyInstance {
  keySuffix: string; // last 4 chars for logging
  genAI: GoogleGenerativeAI;
  model: GenerativeModel;
  dailyTokens: number;
  blocked: boolean; // true when exhausted or rate-limited
  blockedReason: string | null;
  blockedUntil: number; // timestamp when block expires (0 = permanent until midnight)
}

@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger = new Logger(AiService.name);

  private keyInstances: GeminiKeyInstance[] = [];
  private activeKeyIndex = 0;

  // Per-minute usage monitoring & rate limiting (shared across all keys)
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

  // Gemini 2.5 Flash free tier safe thresholds (20% buffer)
  private readonly LIMITS = {
    RPM: 12, // max 12 requests/min (official 15)
    TPM: 800000, // max 800k tokens/min (official 1M)
    DAILY_PER_KEY: 800000, // max 800k tokens/day per key (official 1M)
    FAILURE_THRESHOLD: 5, // 5 consecutive failures → open circuit breaker
    CIRCUIT_BREAKER_DURATION: 900000, // circuit breaker 15min
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

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    await this.initializeGemini();

    // Periodic counter reset
    setInterval(() => {
      this.resetCounters();
    }, 1000);
  }

  private resetCounters() {
    const now = Date.now();

    // Reset per-minute counters
    if (now >= this.usageCounter.resetAt) {
      this.usageCounter.requests = 0;
      this.usageCounter.tokens = 0;
      this.usageCounter.resetAt = now + 60000;
    }

    // Check for date change (midnight reset for ALL keys)
    const today = new Date().toISOString().slice(0, 10);
    if (this.currentDate !== today) {
      this.currentDate = today;

      // Reset all keys at midnight
      for (const key of this.keyInstances) {
        key.dailyTokens = 0;
        key.blocked = false;
        key.blockedReason = null;
        key.blockedUntil = 0;
      }
      this.activeKeyIndex = 0;

      // Also reset service level if it was disabled due to daily exhaustion
      if (this.serviceLevel === AiServiceLevel.DISABLED) {
        this.serviceLevel = AiServiceLevel.FULL;
        this.levelUpdatedAt = now;
      }

      this.logger.log(
        `📅 Daily token counter reset for all ${this.keyInstances.length} keys (${today})`,
      );
    }

    // Unblock keys that have cooled down from 429 (non-midnight unblocking)
    for (const key of this.keyInstances) {
      if (key.blocked && key.blockedUntil > 0 && now >= key.blockedUntil) {
        key.blocked = false;
        key.blockedReason = null;
        key.blockedUntil = 0;
        this.logger.debug(
          `🔑 Key ...${key.keySuffix} unblocked after cooldown`,
        );
      }
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

  private initializeGemini() {
    const apiKeyRaw = this.configService.get<string>('GOOGLE_GEMINI_API_KEY');

    if (!apiKeyRaw) {
      this.logger.warn(
        'Google Gemini API key not configured, AI service disabled',
      );
      return;
    }

    // Support multiple API keys separated by comma
    const keys = apiKeyRaw
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    if (keys.length === 0) {
      this.logger.warn('No valid API keys found, AI service disabled');
      return;
    }

    try {
      for (let i = 0; i < keys.length; i++) {
        const apiKey = keys[i];
        const genAI = new GoogleGenerativeAI(apiKey);

        const model = genAI.getGenerativeModel({
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

        this.keyInstances.push({
          keySuffix: apiKey.slice(-4),
          genAI,
          model,
          dailyTokens: 0,
          blocked: false,
          blockedReason: null,
          blockedUntil: 0,
        });
      }

      this.currentDate = new Date().toISOString().slice(0, 10);
      this.activeKeyIndex = 0;

      this.logger.log(
        `🤖 Google AI Studio initialized with ${keys.length} key(s) (Gemini 2.5 Flash)`,
      );
      this.logger.log(
        `   Active key: ...${this.keyInstances[0].keySuffix} (index 0)`,
      );
    } catch (e) {
      this.logger.error('Failed to initialize Google AI Studio', e);
    }
  }

  /**
   * Try to rotate to the next available key
   * Returns true if a new active key was found, false if all keys are exhausted
   */
  private rotateToNextKey(): boolean {
    const totalKeys = this.keyInstances.length;
    if (totalKeys === 0) {
      return false;
    }

    // If only one key, no rotation possible
    if (totalKeys === 1) {
      if (this.keyInstances[0].blocked) {
        this.serviceLevel = AiServiceLevel.DISABLED;
        this.levelUpdatedAt = Date.now();
        this.logger.warn(
          `🛑 Single key ...${this.keyInstances[0].keySuffix} exhausted, service DISABLED`,
        );
        return false;
      }
      return true; // stays on key 0
    }

    const startIndex = this.activeKeyIndex;

    // Try each key starting from the next one
    for (let attempt = 0; attempt < totalKeys; attempt++) {
      const candidateIndex = (startIndex + 1 + attempt) % totalKeys;
      const candidate = this.keyInstances[candidateIndex];

      const isBlocked = candidate.blocked;
      const isExhausted = candidate.dailyTokens >= this.LIMITS.DAILY_PER_KEY;

      if (!isBlocked && !isExhausted) {
        // Found an available key
        this.activeKeyIndex = candidateIndex;
        this.logger.log(
          `🔑 Switched to key ...${candidate.keySuffix} (index ${candidateIndex})`,
        );
        return true;
      }
    }

    // All keys exhausted — disable service
    this.serviceLevel = AiServiceLevel.DISABLED;
    this.levelUpdatedAt = Date.now();

    const statusLog = this.keyInstances
      .map(
        (k, i) =>
          `[${i}] ...${k.keySuffix}: ${k.dailyTokens}/${this.LIMITS.DAILY_PER_KEY} tokens, blocked=${k.blocked}${k.blockedReason ? ` (${k.blockedReason})` : ''}`,
      )
      .join(', ');
    this.logger.warn(
      `🛑 ALL ${totalKeys} keys exhausted. Service DISABLED until midnight. Status: ${statusLog}`,
    );

    return false;
  }

  /**
   * Traffic control check
   * Returns true if request is allowed
   */
  private checkRateLimit(estimatedTokens: number): boolean {
    // Circuit breaker open
    if (this.circuitBreaker.openUntil > Date.now()) {
      return false;
    }

    // Check if active key is blocked
    const activeKey = this.keyInstances[this.activeKeyIndex];
    if (activeKey?.blocked) {
      // Try to rotate to another key first
      if (this.rotateToNextKey()) {
        // Found another key, allow the request
        return true;
      }
      return false;
    }

    // Check per-minute request quota (shared across all keys)
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

    // Check daily token budget for the ACTIVE key (per-key hard cap)
    if (
      activeKey &&
      activeKey.dailyTokens + estimatedTokens >= this.LIMITS.DAILY_PER_KEY
    ) {
      this.logger.warn(
        `⚠️  Key ...${activeKey.keySuffix} DAILY budget cap reached (${activeKey.dailyTokens}/${this.LIMITS.DAILY_PER_KEY})`,
      );
      // Mark this key as exhausted and try next
      activeKey.blocked = true;
      activeKey.blockedReason = 'daily_exhausted';
      activeKey.blockedUntil = 0; // permanent until midnight

      if (this.rotateToNextKey()) {
        return true; // next key is available
      }
      return false; // all keys exhausted
    }

    return true;
  }

  private recordSuccess(tokens: number) {
    this.usageCounter.requests++;
    this.usageCounter.tokens += tokens;

    // Record against the active key
    const activeKey = this.keyInstances[this.activeKeyIndex];
    if (activeKey) {
      activeKey.dailyTokens += tokens;
    }

    this.circuitBreaker.consecutiveFailures = 0;
  }

  private recordFailure(error?: any) {
    this.circuitBreaker.consecutiveFailures++;
    this.circuitBreaker.lastFailureAt = Date.now();

    // Handle 429 rate limiting (per-key)
    if (error?.status === 429 || error?.message?.includes('429')) {
      const activeKey = this.keyInstances[this.activeKeyIndex];
      if (activeKey) {
        activeKey.blocked = true;
        activeKey.blockedReason = 'rate_limited';
        activeKey.blockedUntil = Date.now() + this.LIMITS.KEY_429_COOLDOWN;
        this.logger.warn(
          `⚠️  Key ...${activeKey.keySuffix} hit 429 rate limit, blocking for ${this.LIMITS.KEY_429_COOLDOWN / 1000}s`,
        );
      }

      // Try to rotate to next key immediately
      this.rotateToNextKey();

      // Also degrade service level for 429
      if (this.serviceLevel > AiServiceLevel.MINIMAL) {
        this.serviceLevel = AiServiceLevel.MINIMAL;
        this.levelUpdatedAt = Date.now();
        this.logger.warn(
          `⚠️  Service downgraded to MINIMAL mode due to 429 error`,
        );
      }
    }

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
   */
  async generateText(
    prompt: string,
    options?: AiGenerationOptions,
    requiredLevel: AiServiceLevel = AiServiceLevel.FULL,
  ): Promise<string | null> {
    const activeKey = this.keyInstances[this.activeKeyIndex];

    if (!activeKey || this.keyInstances.length === 0) {
      return null;
    }

    // Service level check
    if (this.serviceLevel < requiredLevel) {
      return null;
    }

    // Traffic control check
    const estimatedTokens =
      Math.ceil(prompt.length / 4) + (options?.maxOutputTokens || 512);
    if (!this.checkRateLimit(estimatedTokens)) {
      return null;
    }

    // Get fresh active key (may have changed after checkRateLimit rotation)
    const currentKey = this.keyInstances[this.activeKeyIndex];

    try {
      const result = await currentKey.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: options,
      });

      const response = result.response;

      // Safety boundary check
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
      this.recordFailure(e);

      // Special handling for 429 errors (resource exhausted)
      if (e.status === 429 || e.message?.includes('429')) {
        this.logger.warn(
          `⚠️  AI Studio API 429 Resource Exhausted on key ...${currentKey.keySuffix}. Rotating keys.`,
        );
      }

      this.logger.error('AI generation error', e);
      return null;
    }
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
        if (
          (error.status === 429 || error.message?.includes('429')) &&
          attempt < maxRetries
        ) {
          const delay = Math.pow(2, attempt) * 2000; // longer backoff: 2s, 4s, 8s
          this.logger.warn(
            `AI Studio 429 error, waiting ${delay}ms before retry (attempt ${attempt + 1}/${maxRetries})`,
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
   * Generate content from image (for KYC OCR) — shared with KycProviderService
   */
  async generateContentFromImage(
    prompt: string,
    imageBuffer: Buffer,
    mimeType: string = 'image/jpeg',
  ): Promise<string | null> {
    const activeKey = this.keyInstances[this.activeKeyIndex];

    if (!activeKey || this.keyInstances.length === 0) {
      return null;
    }

    if (this.serviceLevel < AiServiceLevel.FULL) {
      return null;
    }

    // Estimate: base64 image size ~ 4/3 of buffer size
    const estimatedTokens =
      Math.ceil(prompt.length / 4) +
      Math.ceil(imageBuffer.length / 3 / 4) +
      512;
    if (!this.checkRateLimit(estimatedTokens)) {
      return null;
    }

    // Get fresh active key (may have changed after checkRateLimit rotation)
    const currentKey = this.keyInstances[this.activeKeyIndex];

    try {
      const imageBase64 = imageBuffer.toString('base64');

      const result = await currentKey.model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType,
                  data: imageBase64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 4096,
        },
      });

      const response = result.response;

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
      this.recordFailure(e);

      if (e.status === 429 || e.message?.includes('429')) {
        this.logger.warn(
          `⚠️  AI Studio 429 in image generation on key ...${currentKey.keySuffix}. Rotating keys.`,
        );
      }

      this.logger.error('AI image generation error', e);
      return null;
    }
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
    if (
      this.keyInstances.length === 0 ||
      this.serviceLevel < AiServiceLevel.FULL
    ) {
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

    return result || text;
  }

  /**
   * Markdown document translation — level FULL
   */
  async translateMarkdown(
    markdown: string,
    targetLang: string,
  ): Promise<string> {
    if (
      this.keyInstances.length === 0 ||
      this.serviceLevel < AiServiceLevel.FULL
    ) {
      return markdown;
    }

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
    return (
      this.keyInstances.length > 0 &&
      this.circuitBreaker.openUntil <= Date.now()
    );
  }

  getServiceLevel(): AiServiceLevel {
    return this.serviceLevel;
  }

  getUsageStats() {
    const totalDaily = this.keyInstances.reduce(
      (sum, k) => sum + k.dailyTokens,
      0,
    );

    return {
      totalKeys: this.keyInstances.length,
      activeKeyIndex: this.activeKeyIndex,
      keys: this.keyInstances.map((k, i) => ({
        index: i,
        keySuffix: k.keySuffix,
        dailyTokens: k.dailyTokens,
        dailyLimit: this.LIMITS.DAILY_PER_KEY,
        blocked: k.blocked,
        blockedReason: k.blockedReason,
        isActive: i === this.activeKeyIndex,
      })),
      requests: this.usageCounter.requests,
      tokens: this.usageCounter.tokens,
      totalDailyTokens: totalDaily,
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
