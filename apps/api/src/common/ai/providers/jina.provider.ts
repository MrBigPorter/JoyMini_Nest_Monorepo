import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AiGenerationOptions } from '../ai.service';
import {
  AiProviderInstance,
  AiKeyInstance,
  AiProviderUsageStats,
} from '../interfaces/ai-provider.interface';

/**
 * JinaProvider — 线上 Embedding + Reranker 服务
 *
 * 替代本地 Infinity（bge-m3），用 Jina AI 的免费 API：
 *   - generateEmbedding() → POST /v1/embeddings（jina-embeddings-v3, 1024维）
 *   - rerank()            → POST /v1/rerank（jina-reranker-v2-base-multilingual）
 *
 * 多账户支持：
 *   JINA_API_KEY 支持逗号分隔多个 Key，自动轮询。
 *   每个 Key 独立计费，一个被限流自动切下一个。
 *
 * 免费额度（每个账户）：
 *   Embedding: 100 RPM, 100K TPM
 *   Reranker:  100 RPM, 100K TPM
 *   4 个账户 ≈ 400 RPM, 400K TPM，开发测试完全够用
 *
 * 如需切回本地 Infinity：
 *   1. 取消 compose.yml 中 infinity 服务的注释
 *   2. 取消 .env 中 INFINITY_EMBEDDING_BASE_URL / RERANK_BASE_URL 的注释
 *   3. 把 ai.module.ts 和 ai.service.ts 中的 JinaProvider 换回 InfinityProvider
 *   4. 重新 make up-ai
 */
@Injectable()
export class JinaProvider implements AiProviderInstance {
  private readonly logger = new Logger(JinaProvider.name);
  readonly name = 'jina';
  readonly displayName = 'Jina AI';
  readonly models = [
    'jina-embeddings-v5-text-small',
    'jina-embeddings-v3',
    'jina-reranker-v3',
    'jina-reranker-v2-base-multilingual',
  ];
  activeModel = 'jina-embeddings-v5-text-small';
  keys: AiKeyInstance[] = [];
  activeKeyIndex = 0;
  available = false;

  /** Jina API base URL */
  private readonly apiBase = 'https://api.jina.ai/v1';

  /** 每个 Key 的独立追踪（apiKey → 用量） */
  private keyInstances: {
    keySuffix: string;
    apiKey: string;
    dailyTokens: number;
    dailyRequests: number;
    blocked: boolean;
    blockedReason: string | null;
    blockedUntil: number;
  }[] = [];

  /** 每个账户每日限额（Jina Free: 1M tokens/day） */
  private readonly DAILY_LIMIT = 1_000_000;

  /** 429 后冷却时间 */
  private readonly KEY_429_COOLDOWN = 60000;

  constructor(private configService: ConfigService) {
    this.initialize();
  }

  private initialize() {
    const raw = this.configService.get<string>('JINA_API_KEY', '');
    if (!raw) {
      this.logger.warn('⚠️ JINA_API_KEY not configured — Jina provider disabled');
      return;
    }

    const keys = raw
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    if (keys.length === 0) {
      this.logger.warn('⚠️ No valid Jina API keys found');
      return;
    }

    for (let i = 0; i < keys.length; i++) {
      this.keyInstances.push({
        keySuffix: keys[i].slice(-4),
        apiKey: keys[i],
        dailyTokens: 0,
        dailyRequests: 0,
        blocked: false,
        blockedReason: null,
        blockedUntil: 0,
      });

      this.keys.push({
        keySuffix: keys[i].slice(-4),
        dailyTokens: 0,
        dailyRequests: 0,
        blocked: false,
        blockedReason: null,
        blockedUntil: 0,
      });
    }

    this.activeKeyIndex = 0;
    this.available = true;
    this.logger.log(
      `🤖 Jina AI provider initialized with ${keys.length} key(s)`,
    );
  }

  /** 获取当前活跃 Key */
  private getCurrentKey(): (typeof this.keyInstances)[0] | null {
    if (this.keyInstances.length === 0) return null;
    return this.keyInstances[this.activeKeyIndex];
  }

  // ===========================================================================
  // Text Generation（不支持）
  // ===========================================================================

  async generateText(
    _prompt: string,
    _options?: AiGenerationOptions,
  ): Promise<string | null> {
    return null; // Jina 只做 embedding + reranker，不做文本生成
  }

  // ===========================================================================
  // Embedding — 文本向量化
  // ===========================================================================

  /**
   * 把文本转为 1024 维向量
   *
   * 调用 Jina Embeddings v3 API:
   *   POST https://api.jina.ai/v1/embeddings
   *   { model: "jina-embeddings-v3", input: text, dimensions: 1024 }
   *
   * 多 Key 自动轮询：当前 Key 被限流或超配额 → 切下一个 Key 重试
   *
   * @param text 要向量化的文本
   * @returns 1024 维向量数组，失败返回 null
   */
  async generateEmbedding(
    text: string,
    options?: { task?: string },
  ): Promise<number[] | null> {
    if (!this.available) return null;

    const totalKeys = this.keyInstances.length;
    for (let attempt = 0; attempt < totalKeys; attempt++) {
      const currentKey = this.getCurrentKey();

      if (!currentKey) return null;

      if (currentKey.blocked || currentKey.dailyTokens >= this.DAILY_LIMIT) {
        this.rotateToNextKey();
        continue;
      }

      try {
        const body: Record<string, any> = {
          model: 'jina-embeddings-v5-text-small',
          input: text,
          dimensions: 1024,
          normalized: true,
        };
        if (options?.task) body.task = options.task;

        const response = await axios.post(
          `${this.apiBase}/embeddings`,
          body,
          {
            headers: {
              Authorization: `Bearer ${currentKey.apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 30000,
          },
        );

        const embedding = response.data?.data?.[0]?.embedding;
        const tokensUsed = response.data?.usage?.total_tokens ?? 0;

        if (Array.isArray(embedding) && embedding.length > 0) {
          currentKey.dailyTokens += tokensUsed;
          currentKey.dailyRequests++;
          return embedding as number[];
        }

        this.logger.warn(
          `Jina embedding returned empty result (key ...${currentKey.keySuffix})`,
        );
        return null;
      } catch (e: any) {
        if (e.response?.status === 429) {
          currentKey.blocked = true;
          currentKey.blockedReason = 'rate_limited';
          currentKey.blockedUntil = Date.now() + this.KEY_429_COOLDOWN;
          this.logger.warn(
            `⚠️ Jina key ...${currentKey.keySuffix} hit 429, cooling ${this.KEY_429_COOLDOWN / 1000}s`,
          );
          // 切到下一个 Key 重试
          this.rotateToNextKey();
          continue;
        }

        // 非 429 错误（网络错误、超时等），记录但不切换 Key
        this.logger.error(
          `Jina embedding error (key ...${currentKey.keySuffix}): ${e.message}`,
        );
        return null;
      }
    }

    // 所有 Key 都试完了
    this.logger.warn('⚠️ All Jina keys exhausted for embedding');
    return null;
  }

  // ===========================================================================
  // Reranker — 重排序
  // ===========================================================================

  /**
   * 对候选文档按 query 相关性重排序
   *
   * 调用 Jina Reranker API:
   *   POST https://api.jina.ai/v1/rerank
   *   { model: "jina-reranker-v2-base-multilingual", query, documents }
   *
   * 多 Key 自动轮询：当前 Key 被限流或超配额 → 切下一个 Key 重试
   *
   * @param query 用户问题
   * @param documents 候选文档数组
   * @returns 按相关性降序的 index 数组，失败返回 null
   */
  async rerank(
    query: string,
    documents: string[],
  ): Promise<Array<{ index: number; relevance_score: number }> | null> {
    if (!this.available || documents.length === 0) return null;

    const totalKeys = this.keyInstances.length;
    for (let attempt = 0; attempt < totalKeys; attempt++) {
      const currentKey = this.getCurrentKey();

      if (!currentKey) return null;

      if (currentKey.blocked || currentKey.dailyTokens >= this.DAILY_LIMIT) {
        this.rotateToNextKey();
        continue;
      }

      try {
        const response = await axios.post(
          `${this.apiBase}/rerank`,
          {
            model: 'jina-reranker-v3',
            query,
            documents,
          },
          {
            headers: {
              Authorization: `Bearer ${currentKey.apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 30000,
          },
        );

        const results = response.data?.results;
        const tokensUsed = response.data?.usage?.total_tokens ?? 0;

        if (Array.isArray(results)) {
          currentKey.dailyTokens += tokensUsed;
          currentKey.dailyRequests++;

          return results
            .sort(
              (a: any, b: any) =>
                (b.relevance_score ?? 0) - (a.relevance_score ?? 0),
            )
            .map((r: any) => ({ index: r.index, relevance_score: r.relevance_score }));
        }

        return null;
      } catch (e: any) {
        if (e.response?.status === 429) {
          currentKey.blocked = true;
          currentKey.blockedReason = 'rate_limited';
          currentKey.blockedUntil = Date.now() + this.KEY_429_COOLDOWN;
          this.logger.warn(
            `⚠️ Jina key ...${currentKey.keySuffix} hit 429 (rerank), cooling ${this.KEY_429_COOLDOWN / 1000}s`,
          );
          this.rotateToNextKey();
          continue;
        }

        this.logger.error(
          `Jina rerank error (key ...${currentKey.keySuffix}): ${e.message}`,
        );
        return null;
      }
    }

    this.logger.warn('⚠️ All Jina keys exhausted for rerank');
    return null;
  }

  // ===========================================================================
  // AiProviderInstance 接口实现
  // ===========================================================================

  isAvailable(): boolean {
    return (
      this.keyInstances.length > 0 &&
      this.keyInstances.some(
        (k) => !k.blocked && k.dailyTokens < this.DAILY_LIMIT,
      )
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

  /**
   * 切换到下一个可用 Key
   *
   * 策略：轮询，跳过被限流或超配额的 Key。
   * 如果所有 Key 都不可用，返回 false。
   */
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
        this.logger.debug(
          `🔑 Jina switched to key ...${candidate.keySuffix} (index ${candidateIndex})`,
        );
        return true;
      }
    }

    this.logger.warn(`🛑 All ${totalKeys} Jina keys exhausted`);
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
      `📅 Jina daily counters reset for ${this.keyInstances.length} keys`,
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
}
