import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AiGenerationOptions } from '../ai.service';
import {
  AiProviderInstance,
  AiKeyInstance,
  AiProviderUsageStats,
} from '../interfaces/ai-provider.interface';

interface DeepSeekKeyState {
  keySuffix: string;
  apiKey: string;
  dailyTokens: number;
  dailyRequests: number;
  blocked: boolean;
  blockedReason: string | null;
  blockedUntil: number;
}

@Injectable()
export class DeepSeekProvider implements AiProviderInstance {
  readonly name = 'deepseek';
  readonly displayName = 'DeepSeek';
  readonly models = [
    'deepseek-chat', // DeepSeek-V3
    'deepseek-reasoner', // DeepSeek-R1
  ];
  activeModel = 'deepseek-chat';

  keys: AiKeyInstance[] = [];
  activeKeyIndex = 0;

  private readonly logger = new Logger(DeepSeekProvider.name);
  private keyInstances: DeepSeekKeyState[] = [];

  // Paid tier: no daily limit (set to max safe value to effectively disable)
  // Free tier had 10M tokens/day limit, but paid keys don't have this restriction
  private readonly DAILY_LIMIT = 999_999_999_999; // Effectively unlimited for paid keys
  private readonly KEY_429_COOLDOWN = 60000; // 60s cooldown for 429

  private readonly BASE_URL = 'https://api.deepseek.com/v1/chat/completions';

  constructor(private configService: ConfigService) {
    this.initialize();
  }

  private initialize() {
    const apiKeyRaw = this.configService.get<string>('DEEPSEEK_API_KEY');

    if (!apiKeyRaw) {
      this.logger.log('DeepSeek API key not configured, provider disabled');
      return;
    }

    const keys = apiKeyRaw
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    if (keys.length === 0) {
      this.logger.log('No valid DeepSeek API keys found');
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

    this.logger.log(
      `🟢 DeepSeek provider initialized with ${keys.length} key(s)`,
    );
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

    // Daily limit check (effectively disabled for paid keys - DAILY_LIMIT is 999B)
    // Paid DeepSeek API keys have no daily token limit

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
          max_tokens: options?.maxOutputTokens ?? 4096,
          stream: false,
        },
        {
          headers: {
            Authorization: `Bearer ${currentKey.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 120000, // DeepSeek can be slower for long content (120s for large articles)
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
          `⚠️ DeepSeek key ...${currentKey.keySuffix} hit 429, blocking for ${this.KEY_429_COOLDOWN / 1000}s`,
        );
        if (this.rotateToNextKey()) {
          return this.generateText(prompt, options); // retry with next key
        }
      } else if (e.response?.status === 400) {
        this.logger.error(
          `DeepSeek API 400 error on key ...${currentKey.keySuffix}: ${e.response?.data?.error?.message || 'Bad request'}`,
        );
      } else if (e.response?.status === 401) {
        this.logger.error(
          `DeepSeek API 401 error on key ...${currentKey.keySuffix}: Invalid API key`,
        );
        currentKey.blocked = true;
        currentKey.blockedReason = 'invalid_key';
        currentKey.blockedUntil = 0;
        if (this.rotateToNextKey()) {
          return this.generateText(prompt, options); // retry with next key
        }
      } else if (e.response?.status === 402) {
        this.logger.error(
          `DeepSeek API 402 error on key ...${currentKey.keySuffix}: Insufficient balance, blocking key permanently`,
        );
        currentKey.blocked = true;
        currentKey.blockedReason = 'insufficient_balance';
        currentKey.blockedUntil = 0; // 余额问题不会自动恢复，永久封锁直到手动重置
        if (this.rotateToNextKey()) {
          return this.generateText(prompt, options); // retry with next key
        }
      } else if (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT') {
        this.logger.warn(
          `DeepSeek API timeout on key ...${currentKey.keySuffix}`,
        );
      } else if (
        e.message === 'aborted' ||
        e.code === 'ERR_CANCELED' ||
        e.code === 'ECONNRESET'
      ) {
        // "aborted" = 连接被 DeepSeek 服务器中断（网络瞬断/负载均衡断开）
        // 不计入 Key 封锁，inline 重试（最多 2 次指数退避）
        const maxRetries = 2;
        for (let retry = 1; retry <= maxRetries; retry++) {
          const delay = retry * 2000; // 2s, 4s 指数退避
          this.logger.warn(
            `DeepSeek connection aborted on key ...${currentKey.keySuffix}, retry ${retry}/${maxRetries} after ${delay}ms`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          try {
            const retryResponse = await axios.post(
              this.BASE_URL,
              {
                model: this.activeModel,
                messages: [
                  ...(options?.systemPrompt
                    ? [
                        {
                          role: 'system' as const,
                          content: options.systemPrompt,
                        },
                      ]
                    : []),
                  { role: 'user' as const, content: prompt },
                ],
                temperature: options?.temperature ?? 0.1,
                max_tokens: options?.maxOutputTokens ?? 4096,
                stream: false,
              },
              {
                headers: {
                  Authorization: `Bearer ${currentKey.apiKey}`,
                  'Content-Type': 'application/json',
                },
                timeout: 120000,
              },
            );
            const retryContent =
              retryResponse.data?.choices?.[0]?.message?.content || null;
            if (retryContent !== null) {
              currentKey.dailyTokens +=
                Math.ceil(prompt.length / 4) +
                Math.ceil(retryContent.length / 4);
              currentKey.dailyRequests++;
            }
            return retryContent;
          } catch (retryError: any) {
            // 如果仍然是 aborted 类错误，继续重试
            if (
              retryError.message === 'aborted' ||
              retryError.code === 'ERR_CANCELED' ||
              retryError.code === 'ECONNRESET'
            ) {
              continue;
            }
            // 非 aborted 错误（如 429/401/402）→ 抛出给外层 catch 处理
            throw retryError;
          }
        }
        // 所有重试耗尽
        this.logger.error(
          `DeepSeek API error on key ...${currentKey.keySuffix}: connection aborted, all ${maxRetries} retries exhausted`,
        );
        return null;
      } else {
        this.logger.error(
          `DeepSeek API error on key ...${currentKey.keySuffix}: ${e.message}`,
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
      const isExhausted = false; // Paid keys have no daily limit

      if (!isBlocked) {
        this.activeKeyIndex = candidateIndex;
        this.logger.log(
          `🔑 DeepSeek switched to key ...${candidate.keySuffix} (index ${candidateIndex})`,
        );
        return true;
      }
    }

    this.logger.warn(`🛑 All ${totalKeys} DeepSeek keys exhausted`);
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
      `📅 DeepSeek daily counters reset for ${this.keyInstances.length} keys`,
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
