import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GoogleGenerativeAI,
  GenerativeModel,
  GenerationConfig,
  HarmCategory,
  HarmBlockThreshold,
} from '@google/generative-ai';
import { AiGenerationOptions } from '../ai.service';
import {
  AiProviderInstance,
  AiKeyInstance,
  AiProviderUsageStats,
} from '../interfaces/ai-provider.interface';

@Injectable()
export class GeminiProvider implements AiProviderInstance {
  readonly name = 'gemini';
  readonly displayName = 'Google Gemini';
  readonly models = ['gemini-2.5-flash'];
  activeModel = 'gemini-2.5-flash';

  keys: AiKeyInstance[] = [];
  activeKeyIndex = 0;

  private readonly logger = new Logger(GeminiProvider.name);
  private keyInstances: {
    keySuffix: string;
    genAI: GoogleGenerativeAI;
    model: GenerativeModel;
    dailyTokens: number;
    dailyRequests: number;
    blocked: boolean;
    blockedReason: string | null;
    blockedUntil: number;
  }[] = [];

  private readonly DAILY_LIMIT = 800000; // 800k tokens/day per key
  private readonly KEY_429_COOLDOWN = 60000; // 60s cooldown for 429

  constructor(private configService: ConfigService) {
    this.initialize();
  }

  /**
   * 统一的模型构造入口。
   *
   * systemPrompt 必须走 `systemInstruction`：Gemini 的 `generationConfig`
   * 不认识这个字段，直接透传会得到 400 Invalid JSON payload。
   */
  private buildModel(
    genAI: GoogleGenerativeAI,
    systemPrompt?: string,
  ): GenerativeModel {
    return genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      ...(systemPrompt ? { systemInstruction: systemPrompt } : {}),
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
  }

  private initialize() {
    const apiKeyRaw = this.configService.get<string>('GOOGLE_GEMINI_API_KEY');

    if (!apiKeyRaw) {
      this.logger.warn('Google Gemini API key not configured');
      return;
    }

    const keys = apiKeyRaw
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    if (keys.length === 0) {
      this.logger.warn('No valid Gemini API keys found');
      return;
    }

    try {
      for (let i = 0; i < keys.length; i++) {
        const apiKey = keys[i];
        const genAI = new GoogleGenerativeAI(apiKey);

        const model = this.buildModel(genAI);

        this.keyInstances.push({
          keySuffix: apiKey.slice(-4),
          genAI,
          model,
          dailyTokens: 0,
          dailyRequests: 0,
          blocked: false,
          blockedReason: null,
          blockedUntil: 0,
        });
      }

      this.activeKeyIndex = 0;

      this.logger.log(
        `🤖 Gemini provider initialized with ${keys.length} key(s)`,
      );
    } catch (e) {
      this.logger.error('Failed to initialize Gemini provider', e);
    }
  }

  async generateText(
    prompt: string,
    options?: AiGenerationOptions,
  ): Promise<string | null> {
    const currentKey = this.keyInstances[this.activeKeyIndex];

    if (!currentKey || this.keyInstances.length === 0) {
      return null;
    }

    try {
      // 只把 Gemini 认识的字段放进 generationConfig；未知字段会被 API 拒绝。
      const { systemPrompt, ...rest } = options ?? {};
      const generationConfig: GenerationConfig = {
        ...(rest.temperature !== undefined
          ? { temperature: rest.temperature }
          : {}),
        ...(rest.maxOutputTokens !== undefined
          ? { maxOutputTokens: rest.maxOutputTokens }
          : {}),
        ...(rest.responseMimeType
          ? { responseMimeType: rest.responseMimeType }
          : {}),
      };

      const model = systemPrompt
        ? this.buildModel(currentKey.genAI, systemPrompt)
        : currentKey.model;

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        ...(Object.keys(generationConfig).length > 0
          ? { generationConfig }
          : {}),
      });

      const response = result.response;

      if (
        !response ||
        !response.candidates ||
        response.candidates.length === 0
      ) {
        return null;
      }

      // Record success
      const estimatedTokens =
        Math.ceil(prompt.length / 4) + (options?.maxOutputTokens || 512);
      currentKey.dailyTokens += estimatedTokens;
      currentKey.dailyRequests++;

      return response.candidates[0]?.content?.parts?.[0]?.text || null;
    } catch (e: any) {
      // Handle 429 rate limiting
      if (e.status === 429 || e.message?.includes('429')) {
        currentKey.blocked = true;
        currentKey.blockedReason = 'rate_limited';
        currentKey.blockedUntil = Date.now() + this.KEY_429_COOLDOWN;
        this.logger.warn(
          `⚠️ Gemini key ...${currentKey.keySuffix} hit 429, blocking for ${this.KEY_429_COOLDOWN / 1000}s`,
        );
        if (this.rotateToNextKey()) {
          return this.generateText(prompt, options); // retry with next key
        }
      }

      this.logger.error(
        `Gemini generation error on key ...${currentKey.keySuffix}`,
        e,
      );
      return null;
    }
  }

  /**
   * Generate content from image (vision/OCR) — Gemini-only feature
   */
  async generateContentFromImage(
    prompt: string,
    imageBuffer: Buffer,
    mimeType: string = 'image/jpeg',
  ): Promise<string | null> {
    const currentKey = this.keyInstances[this.activeKeyIndex];

    if (!currentKey || this.keyInstances.length === 0) {
      return null;
    }

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
        return null;
      }

      const estimatedTokens =
        Math.ceil(prompt.length / 4) +
        Math.ceil(imageBuffer.length / 3 / 4) +
        512;
      currentKey.dailyTokens += estimatedTokens;
      currentKey.dailyRequests++;

      return response.candidates[0]?.content?.parts?.[0]?.text || null;
    } catch (e: any) {
      if (e.status === 429 || e.message?.includes('429')) {
        currentKey.blocked = true;
        currentKey.blockedReason = 'rate_limited';
        currentKey.blockedUntil = Date.now() + this.KEY_429_COOLDOWN;
        this.rotateToNextKey();
      }
      this.logger.error('Gemini image generation error', e);
      return null;
    }
  }

  isAvailable(): boolean {
    return (
      this.keyInstances.length > 0 && this.keyInstances.some((k) => !k.blocked)
    );
  }

  rotateToNextKey(): boolean {
    const totalKeys = this.keyInstances.length;
    if (totalKeys === 0) return false;

    if (totalKeys === 1) {
      return !this.keyInstances[0].blocked;
    }

    const startIndex = this.activeKeyIndex;

    for (let attempt = 0; attempt < totalKeys; attempt++) {
      const candidateIndex = (startIndex + 1 + attempt) % totalKeys;
      const candidate = this.keyInstances[candidateIndex];

      const isBlocked = candidate.blocked;
      const isExhausted = candidate.dailyTokens >= this.DAILY_LIMIT;

      if (!isBlocked && !isExhausted) {
        this.activeKeyIndex = candidateIndex;
        this.logger.log(
          `🔑 Gemini switched to key ...${candidate.keySuffix} (index ${candidateIndex})`,
        );
        return true;
      }
    }

    this.logger.warn(`🛑 All ${totalKeys} Gemini keys exhausted`);
    return false;
  }

  resetDailyCounters(): void {
    for (const key of this.keyInstances) {
      key.dailyTokens = 0;
      key.dailyRequests = 0;
      key.blocked = false;
      key.blockedReason = null;
      key.blockedUntil = 0;
    }
    this.activeKeyIndex = 0;
    this.logger.log(
      `📅 Gemini daily counters reset for ${this.keyInstances.length} keys`,
    );
  }

  unblockExpiredKeys(now: number): void {
    for (const key of this.keyInstances) {
      if (key.blocked && key.blockedUntil > 0 && now >= key.blockedUntil) {
        key.blocked = false;
        key.blockedReason = null;
        key.blockedUntil = 0;
      }
    }
  }

  getUsageStats(): AiProviderUsageStats {
    return {
      name: this.name,
      displayName: this.displayName,
      activeModel: this.activeModel,
      activeKeyIndex: this.activeKeyIndex,
      keys: this.keyInstances.map((k, i) => ({
        index: i,
        keySuffix: k.keySuffix,
        dailyTokens: k.dailyTokens,
        dailyRequests: k.dailyRequests,
        dailyLimit: this.DAILY_LIMIT,
        blocked: k.blocked,
        blockedReason: k.blockedReason,
        isActive: i === this.activeKeyIndex,
      })),
    };
  }
}
