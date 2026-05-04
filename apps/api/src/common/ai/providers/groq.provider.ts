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
  requestTimestamps: number[];
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
  private readonly KEY_429_COOLDOWN_DEFAULT = 120000; // 2min default cooldown (read Retry-After header first)
  private readonly RPM_LIMIT = 30; // Groq free tier: ~30 requests/min per key
  private readonly RPM_WINDOW_MS = 60000; // 60-second rolling window

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
        requestTimestamps: [],
      });
    }

    this.activeKeyIndex = 0;

    this.logger.log(`🟢 Groq provider initialized with ${keys.length} key(s)`);
  }

  async generateText(
    prompt: string,
    options?: AiGenerationOptions,
  ): Promise<string | null> {
    // Proactive availability check: select the best key by RPM
    // If all keys are blocked (429 cooldown) or at RPM limit, return null immediately.
    // DO NOT wait inside generateText() — that would block the event loop and
    // could generate a retry storm of 429 requests that resets Groq's rate limit clock.
    // Let the processor's handleRateLimit() manage retry timing instead.
    const selected = this.selectBestKey();
    if (!selected) {
      this.logger.warn(
        `🛑 All ${this.keyInstances.length} Groq keys unavailable, returning null immediately`,
      );
      return null;
    }

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
        if (!this.selectBestKey()) return null;
        return this.generateText(prompt, options); // retry with next key
      }
    }

    // Check daily limit
    if (currentKey.dailyTokens >= this.DAILY_LIMIT) {
      currentKey.blocked = true;
      currentKey.blockedReason = 'daily_exhausted';
      currentKey.blockedUntil = 0;
      if (!this.selectBestKey()) return null;
      return this.generateText(prompt, options); // retry with next key
    }

    // Record request timestamp for RPM tracking (before API call)
    this.pruneStaleTimestamps(currentKey);
    currentKey.requestTimestamps.push(Date.now());

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
      // On failure, remove the timestamp we recorded (failed calls don't count toward RPM)
      currentKey.requestTimestamps.pop();
      if (e.response?.status === 429) {
        // Read Retry-After header from Groq response
        // Cap max cooldown at 3× default (360s = 6 min) to prevent absurdly long blocks
        // like Groq returning retry-after: 7409 (2 hours+)
        const retryAfter = e.response?.headers?.['retry-after'];
        const parsedRetryAfter = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : 0;
        const cooldownMs =
          parsedRetryAfter > 0
            ? Math.min(parsedRetryAfter, this.KEY_429_COOLDOWN_DEFAULT * 3)
            : this.KEY_429_COOLDOWN_DEFAULT;
        const cooldownUntil = Date.now() + cooldownMs;

        // Block only the key that hit 429 — other keys are tried next via selectBestKey()
        currentKey.blocked = true;
        currentKey.blockedReason = 'rate_limited';
        currentKey.blockedUntil = cooldownUntil;

        this.logger.warn(
          `⚠️ Groq key ...${currentKey.keySuffix} hit 429, blocking key for ${cooldownMs / 1000}s (${this.keyInstances.length - 1} other keys still available)`,
        );

        // Return null immediately — do NOT wait, do NOT retry.
        // This breaks the retry storm: no more 429 requests → Groq's rate limit clock can expire.
        // The processor's handleRateLimit() and unblockExpiredKeys() (1s interval) handle recovery.
        return null;
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
    // Prune stale timestamps for accurate availability check
    for (const key of this.keyInstances) {
      this.pruneStaleTimestamps(key);
    }
    return (
      this.keyInstances.length > 0 &&
      this.keyInstances.some(
        (k) => !k.blocked && k.requestTimestamps.length < this.RPM_LIMIT,
      )
    );
  }

  /**
   * Remove request timestamps older than the RPM window (60s).
   */
  private pruneStaleTimestamps(key: GroqKeyState): void {
    const cutoff = Date.now() - this.RPM_WINDOW_MS;
    key.requestTimestamps = key.requestTimestamps.filter((t) => t > cutoff);
  }

  /**
   * Select the key with the lowest request count in the rolling 60-second window.
   * This proactively distributes load to prevent rate limiting.
   */
  selectBestKey(): boolean {
    const totalKeys = this.keyInstances.length;
    if (totalKeys === 0) return false;

    // Prune stale timestamps on all keys first
    for (const key of this.keyInstances) {
      this.pruneStaleTimestamps(key);
    }

    let bestIndex = -1;
    let bestRpm = Infinity;

    for (let i = 0; i < totalKeys; i++) {
      const key = this.keyInstances[i];

      // Skip blocked or daily-exhausted keys
      if (key.blocked) continue;
      if (key.dailyTokens >= this.DAILY_LIMIT) continue;

      const rpm = key.requestTimestamps.length;
      if (rpm < bestRpm) {
        bestRpm = rpm;
        bestIndex = i;
      }
    }

    if (bestIndex >= 0 && bestRpm < this.RPM_LIMIT) {
      if (bestIndex !== this.activeKeyIndex) {
        this.logger.log(
          `🔑 Groq selected key ...${this.keyInstances[bestIndex].keySuffix} (index ${bestIndex}, RPM ${bestRpm})`,
        );
      }
      this.activeKeyIndex = bestIndex;
      return true;
    }

    // All keys at RPM limit
    this.logger.warn(
      `🛑 All ${totalKeys} Groq keys at rate limit (best RPM: ${bestRpm >= Infinity ? 'N/A' : bestRpm})`,
    );
    return false;
  }

  /**
   * Calculate the minimum wait time until a key becomes available within the RPM window.
   * Returns 0 if no wait is needed, or the ms to wait for the soonest slot.
   */
  private getMinRpmWaitTime(): number {
    let minWait = Infinity;

    for (const key of this.keyInstances) {
      if (key.blocked) continue;
      if (key.dailyTokens >= this.DAILY_LIMIT) continue;

      this.pruneStaleTimestamps(key);

      if (key.requestTimestamps.length < this.RPM_LIMIT) {
        return 0; // A key is already available
      }

      // Key is at its RPM limit — the oldest timestamp will expire soonest
      if (key.requestTimestamps.length > 0) {
        const oldestTimestamp = key.requestTimestamps[0];
        const waitMs = oldestTimestamp + this.RPM_WINDOW_MS - Date.now() + 100; // +100ms buffer
        if (waitMs < minWait) {
          minWait = waitMs;
        }
      }
    }

    return minWait === Infinity ? 0 : minWait;
  }

  /**
   * Calculate the minimum wait time until a 429-blocked key becomes available.
   * Returns 0 if no blocked keys exist, or the ms to wait for the soonest unblock.
   */
  private getMinBlockedWaitTime(): number {
    let minWait = Infinity;
    const now = Date.now();
    for (const key of this.keyInstances) {
      if (key.blocked && key.blockedUntil > now) {
        minWait = Math.min(minWait, key.blockedUntil - now);
      }
    }
    return minWait === Infinity ? 0 : minWait + 100; // +100ms buffer
  }

  resetDailyCounters(): void {
    for (const key of this.keyInstances) {
      key.dailyTokens = 0;
      key.dailyRequests = 0;
      key.blocked = false;
      key.blockedReason = null;
      key.blockedUntil = 0;
      key.requestTimestamps = [];
    }
    this.activeKeyIndex = 0;
    this.logger.log(
      `📅 Groq daily counters reset for ${this.keyInstances.length} keys`,
    );
  }

  /**
   * Interface-compatible wrapper that delegates to the RPM-aware selectBestKey().
   */
  rotateToNextKey(): boolean {
    return this.selectBestKey();
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
    for (const key of this.keyInstances) {
      this.pruneStaleTimestamps(key);
    }
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
        currentRpm: k.requestTimestamps.length,
        rpmLimit: this.RPM_LIMIT,
      })),
    };
  }
}
