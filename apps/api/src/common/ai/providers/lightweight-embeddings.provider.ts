import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { AiGenerationOptions } from '../ai.service';
import {
  AiProviderInstance,
  AiKeyInstance,
  AiProviderUsageStats,
} from '../interfaces/ai-provider.interface';

/**
 * LightweightEmbeddingsProvider — 线上 Embedding + Reranker 免费服务
 *
 * 替代 Jina AI（收费），用 Lightweight Embeddings 的免费托管 API：
 *   - generateEmbedding() → POST /v1/embeddings（bge-m3, 1024维）
 *   - rerank()            → POST /v1/rank（bge-m3）
 *
 * 免费额度（匿名，无需注册）：
 *   1 RPS, 30 RPM, 2,000 CU/天
 *   bge-m3 cost weight = 5.0，约 400 token/天
 *
 * 如需更高配额：
 *   1. 自建 Docker: docker run --rm -p 7860:7860 ghcr.io/lh0x00/lightweight-embeddings
 *   2. 或注册 Hugging Face 账号获取更高额度
 *
 * API 文档：https://github.com/lh0x00/lightweight-embeddings
 */
@Injectable()
export class LightweightEmbeddingsProvider implements AiProviderInstance {
  private readonly logger = new Logger(LightweightEmbeddingsProvider.name);
  readonly name = 'lightweight-embeddings';
  readonly displayName = 'Lightweight Embeddings';
  readonly models = ['bge-m3'];
  activeModel = 'bge-m3';
  keys: AiKeyInstance[] = [];
  activeKeyIndex = 0;
  available = true;

  /** API base URL（Hugging Face 托管版） */
  private readonly apiBase = 'https://lamhieu-lightweight-embeddings.hf.space/v1';

  /** 429 重试配置 */
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY_MS = 1200; // 略 > 1s 给 RPS 限流留余量

  constructor() {
    this.logger.log('🤖 LightweightEmbeddings provider initialized (free tier)');
  }

  // ===========================================================================
  // Text Generation（不支持）
  // ===========================================================================

  async generateText(
    _prompt: string,
    _options?: AiGenerationOptions,
  ): Promise<string | null> {
    return null; // 只做 embedding + reranker
  }

  // ===========================================================================
  // Embedding — 文本向量化（bge-m3, 1024维）
  // ===========================================================================

  /**
   * 把文本转为 1024 维向量
   *
   * 调用 Lightweight Embeddings API:
   *   POST /v1/embeddings
   *   { model: "bge-m3", input: text }
   *
   * 429 限流时自动重试（~1.2s 间隔）
   *
   * @param text 要向量化的文本
   * @returns 1024 维向量数组，失败返回 null
   */
  async generateEmbedding(text: string): Promise<number[] | null> {
    if (!this.available) return null;

    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const response = await axios.post(
          `${this.apiBase}/embeddings`,
          {
            model: 'bge-m3',
            input: text,
          },
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000,
          },
        );

        const embedding = response.data?.data?.[0]?.embedding;
        if (Array.isArray(embedding) && embedding.length > 0) {
          return embedding as number[];
        }

        this.logger.warn(
          `LightweightEmbeddings returned empty embedding`,
        );
        return null;
      } catch (e: any) {
        if (e.response?.status === 429 && attempt < this.MAX_RETRIES) {
          this.logger.warn(
            `⚠️ LightweightEmbeddings rate limited (429), retry ${attempt + 1}/${this.MAX_RETRIES} after ${this.RETRY_DELAY_MS}ms`,
          );
          await this.sleep(this.RETRY_DELAY_MS);
          continue;
        }

        // 非 429 错误或重试耗尽
        this.logger.error(
          `LightweightEmbeddings embedding error: ${e.message}`,
        );
        return null;
      }
    }

    return null;
  }

  // ===========================================================================
  // Reranker — 重排序
  // ===========================================================================

  /**
   * 对候选文档按 query 相关性重排序
   *
   * 调用 Lightweight Embeddings Reranker API:
   *   POST /v1/rank
   *   { model: "bge-m3", queries: query, candidates: documents }
   *
   * 使用 cosine_similarities 排序（probabilities 在某些模型上可能全为 0/1）
   *
   * @param query 用户问题
   * @param documents 候选文档数组
   * @returns 按相关性降序的 index 数组，失败返回 null
   */
  async rerank(
    query: string,
    documents: string[],
  ): Promise<number[] | null> {
    if (!this.available || documents.length === 0) return null;

    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const response = await axios.post(
          `${this.apiBase}/rank`,
          {
            model: 'bge-m3',
            queries: query,
            candidates: documents,
          },
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000,
          },
        );

        // 响应格式：{ cosine_similarities: [[score1, score2, ...]], probabilities: [[...]] }
        const cosineSims = response.data?.cosine_similarities?.[0] as
          | number[]
          | undefined;
        const probs = response.data?.probabilities?.[0] as
          | number[]
          | undefined;

        // 优先用 cosine_similarities，回退到 probabilities
        const scores = cosineSims ?? probs;
        if (!Array.isArray(scores) || scores.length === 0) {
          this.logger.warn('LightweightEmbeddings rerank returned empty scores');
          return null;
        }

        // 按分数降序返回索引
        return scores
          .map((score, index) => ({ score, index }))
          .sort((a, b) => b.score - a.score)
          .map((item) => item.index);
      } catch (e: any) {
        if (e.response?.status === 429 && attempt < this.MAX_RETRIES) {
          this.logger.warn(
            `⚠️ LightweightEmbeddings rate limited (429) on rerank, retry ${attempt + 1}/${this.MAX_RETRIES}`,
          );
          await this.sleep(this.RETRY_DELAY_MS);
          continue;
        }

        this.logger.error(
          `LightweightEmbeddings rerank error: ${e.message}`,
        );
        return null;
      }
    }

    return null;
  }

  // ===========================================================================
  // AiProviderInstance 接口实现
  // ===========================================================================

  isAvailable(): boolean {
    return this.available;
  }

  getUsageStats(): AiProviderUsageStats {
    return {
      name: this.name,
      displayName: this.displayName,
      activeModel: this.activeModel,
      activeKeyIndex: 0,
      keys: [
        {
          index: 0,
          keySuffix: 'free',
          dailyTokens: 0,
          dailyRequests: 0,
          dailyLimit: 2000,
          blocked: false,
          blockedReason: null,
          isActive: true,
        },
      ],
    };
  }

  rotateToNextKey(): boolean {
    return true; // 单 Key，始终可用
  }

  resetDailyCounters(): void {
    // 无需重置
  }

  unblockExpiredKeys(_now: number): void {
    // 无需解锁
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
