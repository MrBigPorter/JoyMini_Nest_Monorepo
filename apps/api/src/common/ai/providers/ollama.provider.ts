import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AiGenerationOptions } from '../ai.service';
import {
  AiProviderInstance,
  AiKeyInstance,
  AiProviderUsageStats,
} from '../interfaces/ai-provider.interface';

@Injectable()
export class OllamaProvider implements AiProviderInstance {
  readonly name = 'ollama';
  readonly displayName = 'Ollama (Local LLM)';
  readonly models = ['qwen3.5:0.8b', 'mxbai-embed-large'];
  activeModel = 'qwen3.5:0.8b';

  keys: AiKeyInstance[] = [];
  activeKeyIndex = 0;

  private readonly logger = new Logger(OllamaProvider.name);
  private baseUrl = '';
  private available = false;

  // Ollama local instance: no daily limit, simplified key tracking
  private readonly DAILY_LIMIT = 999_999_999_999;

  constructor(private configService: ConfigService) {
    this.initialize();
  }

  private initialize() {
    const baseUrl = this.configService.get<string>('AI_OLLAMA_BASE_URL');
    const model = this.configService.get<string>('OLLAMA_MODEL');

    if (!baseUrl) {
      this.logger.log('Ollama base URL not configured, provider disabled');
      return;
    }

    this.baseUrl = `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;

    if (model) {
      this.activeModel = model;
    }

    // Single "key" placeholder for Ollama (no auth needed)
    this.keys = [
      {
        keySuffix: 'local',
        dailyTokens: 0,
        dailyRequests: 0,
        blocked: false,
        blockedReason: null,
        blockedUntil: 0,
      },
    ];

    this.activeKeyIndex = 0;
    this.available = true;

    this.logger.log(
      `🟢 Ollama provider initialized (model: ${this.activeModel}, url: ${this.baseUrl})`,
    );
  }

  async generateText(
    prompt: string,
    options?: AiGenerationOptions,
  ): Promise<string | null> {
    if (!this.available) return null;

    const currentKey = this.keys[this.activeKeyIndex];

    if (!currentKey) return null;

    try {
      const response = await axios.post(
        this.baseUrl,
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
          stream: false,
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 120000, // 120s timeout for local LLM (slower on CPU)
        },
      );

      const content = response.data?.choices?.[0]?.message?.content || null;

      if (content !== null) {
        const estimatedTokens =
          Math.ceil(prompt.length / 4) + Math.ceil(content.length / 4);
        currentKey.dailyTokens += estimatedTokens;
        currentKey.dailyRequests++;
      }

      return content;
    } catch (e: any) {
      if (e.code === 'ECONNREFUSED') {
        this.logger.warn(
          `Ollama connection refused at ${this.baseUrl} — is the Ollama service running?`,
        );
        this.available = false;
      } else if (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT') {
        this.logger.warn('Ollama request timed out');
      } else {
        this.logger.error(`Ollama API error: ${e.message}`);
      }

      return null;
    }
  }

  isAvailable(): boolean {
    return this.available && this.keys.length > 0;
  }

  rotateToNextKey(): boolean {
    return this.keys.length > 0;
  }

  resetDailyCounters(): void {
    for (const key of this.keys) {
      key.dailyTokens = 0;
      key.dailyRequests = 0;
      key.blocked = false;
      key.blockedReason = null;
      key.blockedUntil = 0;
    }
    this.activeKeyIndex = 0;
    this.logger.log('📅 Ollama daily counters reset');
  }

  unblockExpiredKeys(_now: number): void {
    // Ollama has no rate limiting, no-op
  }

  getUsageStats(): AiProviderUsageStats {
    return {
      name: this.name,
      displayName: this.displayName,
      activeModel: this.activeModel,
      activeKeyIndex: this.activeKeyIndex,
      keys: this.keys.map((k, i) => ({
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
