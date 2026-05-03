import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AiGenerationOptions } from '../ai.service';
import {
  AiProviderInstance,
  AiKeyInstance,
  AiProviderUsageStats,
} from '../interfaces/ai-provider.interface';

interface GroqKeyState {
  keySuffix: string;
  apiKey: string;
  dailyTokens: number;
  dailyRequests: number;
  blocked: boolean;
  blockedReason: string | null;
  blockedUntil: number;
}

@Injectable()
export class GroqProvider implements AiProviderInstance {
  readonly name = 'groq';
  readonly displayName = 'Groq';
  readonly models = [
    'llama-3.3-70b-versatile',
    'llama3-70b-8192',
    'llama-3.1-8b-instant',
  ];
  activeModel = 'llama-3.3-70b-versatile';

  keys: AiKeyInstance[] = [];
  activeKeyIndex = 0;

  private readonly logger = new Logger(GroqProvider.name);
  private keyInstances: GroqKeyState[] = [];

  private readonly DAILY_LIMIT = 500000; // 500k tokens/day per key (Groq free tier)
  private readonly KEY_429_COOLDOWN = 60000; // 60s cooldown for 429

  private readonly BASE_URL = 'https://api.groq.com/openai/v1/chat/completions';

  constructor(private configService: ConfigService) {
    this.initialize();
  }

  private initialize() {
    const apiKeyRaw = this.configService.get<string>('GROQ_API_KEY');

    if (!apiKeyRaw) {
      this.logger.log('Groq API key not configured, provider disabled');
      return;
    }

    const keys = apiKeyRaw
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    if (keys.length === 0) {
      this.logger.log('No valid Groq API keys found');
      return;
    }

    for (let i = 0; i < keys.length; i++) {
      const apiKey = keys[i];
      this.keyInstances.push({
        keySuffix: apiKey.slice(-4),
        apiKey,
        dailyTokens: 0,
        dailyRequests: 0,
        blocked: false,
        blockedReason: null,
        blockedUntil: 0,
      });
    }

    this.activeKeyIndex = 0;

    this.logger.log(`🟢 Groq provider initialized with ${keys.length} key(s)`);
  }

  async generateText(
    prompt: string,
    options?: AiGenerationOptions,
  ): Promise<string | null> {
    const currentKey = this.keyInstances[this.activeKeyIndex];

    if (!currentKey || this.keyInstances.length === 0) {
      return null;
    }

    // Check if key is blocked
    if (currentKey.blocked) {
      if (
        currentKey.blockedUntil > 0 &&
        Date.now() >= currentKey.blockedUntil
      ) {
        currentKey.blocked = false;
        currentKey.blockedReason = null;
        currentKey.blockedUntil = 0;
      } else {
        if (!this.rotateToNextKey()) return null;
        return this.generateText(prompt, options); // retry with next key
      }
    }

    // Check daily limit
    if (currentKey.dailyTokens >= this.DAILY_LIMIT) {
      currentKey.blocked = true;
      currentKey.blockedReason = 'daily_exhausted';
      currentKey.blockedUntil = 0;
      if (!this.rotateToNextKey()) return null;
      return this.generateText(prompt, options); // retry with next key
    }

    try {
      const response = await axios.post(
        this.BASE_URL,
        {
          model: this.activeModel,
          messages: [
            ...(options?.systemPrompt
              ? [{ role: 'system' as const, content: options.systemPrompt }]
              : []),
            { role: 'user' as const, content: prompt },
          ],
          temperature: options?.temperature ?? 0.1,
          max_tokens: options?.maxOutputTokens ?? 2048,
        },
        {
          headers: {
            Authorization: `Bearer ${currentKey.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      );

      const content = response.data?.choices?.[0]?.message?.content || null;

      if (content !== null) {
        // Estimate tokens (rough: 4 chars ≈ 1 token)
        const estimatedTokens =
          Math.ceil(prompt.length / 4) + Math.ceil(content.length / 4);
        currentKey.dailyTokens += estimatedTokens;
        currentKey.dailyRequests++;
      }

      return content;
    } catch (e: any) {
      if (e.response?.status === 429) {
        currentKey.blocked = true;
        currentKey.blockedReason = 'rate_limited';
        currentKey.blockedUntil = Date.now() + this.KEY_429_COOLDOWN;
        this.logger.warn(
          `⚠️ Groq key ...${currentKey.keySuffix} hit 429, blocking for ${this.KEY_429_COOLDOWN / 1000}s`,
        );
        this.rotateToNextKey();
      } else if (e.response?.status === 400) {
        this.logger.error(
          `Groq API 400 error on key ...${currentKey.keySuffix}: ${e.response?.data?.error?.message || 'Bad request'}`,
        );
      } else if (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT') {
        this.logger.warn(`Groq API timeout on key ...${currentKey.keySuffix}`);
      } else {
        this.logger.error(
          `Groq API error on key ...${currentKey.keySuffix}: ${e.message}`,
        );
      }

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
          `🔑 Groq switched to key ...${candidate.keySuffix} (index ${candidateIndex})`,
        );
        return true;
      }
    }

    this.logger.warn(`🛑 All ${totalKeys} Groq keys exhausted`);
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
      `📅 Groq daily counters reset for ${this.keyInstances.length} keys`,
    );
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
