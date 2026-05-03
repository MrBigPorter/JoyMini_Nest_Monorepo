import { AiGenerationOptions } from '../ai.service';

export interface AiKeyInstance {
  keySuffix: string;
  dailyTokens: number;
  dailyRequests: number;
  blocked: boolean;
  blockedReason: string | null;
  blockedUntil: number;
}

export interface AiProviderInstance {
  readonly name: string;
  readonly displayName: string;
  readonly models: string[];
  activeModel: string;

  keys: AiKeyInstance[];
  activeKeyIndex: number;

  generateText(
    prompt: string,
    options?: AiGenerationOptions,
  ): Promise<string | null>;
  isAvailable(): boolean;
  getUsageStats(): AiProviderUsageStats;
  rotateToNextKey(): boolean;
  resetDailyCounters(): void;
  /** Unblock keys whose cooldown timer has expired. Called every second by AiService. */
  unblockExpiredKeys(now: number): void;
}

export interface AiProviderUsageStats {
  name: string;
  displayName: string;
  activeModel: string;
  activeKeyIndex: number;
  keys: {
    index: number;
    keySuffix: string;
    dailyTokens: number;
    dailyRequests: number;
    dailyLimit: number;
    blocked: boolean;
    blockedReason: string | null;
    isActive: boolean;
    currentRpm?: number;
    rpmLimit?: number;
  }[];
}
