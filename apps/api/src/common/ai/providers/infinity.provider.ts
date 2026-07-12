import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AiProviderInstance, AiKeyInstance, AiProviderUsageStats } from '../interfaces/ai-provider.interface';

/**
 * InfinityProvider — 专用 Embedding + Rerank 引擎
 *
 * Infinity 是专为 embedding 和 rerank 设计的高性能引擎，
 * 比 Ollama 跑 bge-m3 更轻更快。本 Provider 接管：
 *   - generateEmbedding() → POST /embeddings（bge-m3）
 *   - rerank()            → POST /rerank（bge-reranker-v2-m3）
 *
 * 生活类比：从「大厨房（Ollama）」的化验室搬到「专业检测中心（Infinity）」。
 *   同一个化验员（bge-m3），但设备更专业、占地方更小。
 */
@Injectable()
export class InfinityProvider implements AiProviderInstance {
  private readonly logger = new Logger(InfinityProvider.name);
  readonly name = 'infinity';
  readonly displayName = 'Infinity';
  readonly models = ['BAAI/bge-m3', 'BAAI/bge-reranker-v2-m3'];
  activeModel = 'BAAI/bge-m3';
  keys: AiKeyInstance[] = [];
  activeKeyIndex = 0;
  available = false;

  private embedBaseUrl: string;
  private rerankBaseUrl: string;
  private embedModel: string;
  private rerankModel: string;

  constructor(private configService: ConfigService) {
    this.embedBaseUrl = this.configService.get<string>(
      'INFINITY_EMBEDDING_BASE_URL',
      'http://joymini-infinity:7997',
    );
    this.rerankBaseUrl = this.configService.get<string>(
      'RERANK_BASE_URL',
      'http://joymini-infinity:7997',
    );
    this.embedModel = this.configService.get<string>(
      'INFINITY_EMBEDDING_MODEL',
      'BAAI/bge-m3',
    );
    this.rerankModel = this.configService.get<string>(
      'RERANK_MODEL',
      'BAAI/bge-reranker-v2-m3',
    );
    this.available = !!this.configService.get('INFINITY_EMBEDDING_BASE_URL');
  }

  /**
   * 文本向量化 — 把文字转成 1024 维向量
   *
   * 调用 Infinity 的 /embeddings 接口（OpenAI 兼容格式）
   *
   * @param text 要向量化的文本
   * @returns 1024 维向量数组，失败返回 null
   */
  async generateEmbedding(text: string): Promise<number[] | null> {
    if (!this.available) return null;

    try {
      const baseUrl = this.embedBaseUrl.replace(/\/+$/, '');
      const response = await axios.post(
        `${baseUrl}/embeddings`,
        {
          model: this.embedModel,
          input: text,
        },
        { timeout: 30000 },
      );

      const embedding = response.data?.data?.[0]?.embedding;

      if (Array.isArray(embedding) && embedding.length > 0) {
        return embedding as number[];
      }

      this.logger.warn('Infinity embedding returned empty result');
      return null;
    } catch (e: any) {
      if (e.code === 'ECONNREFUSED') {
        this.logger.warn(`Infinity connection refused at ${this.embedBaseUrl} — is Infinity running?`);
        // 不永久禁用 — 下次调用自动重试，Infinity 可能只是暂时未就绪
        // this.available = false;
      } else {
        this.logger.error(`Infinity embedding error: ${e.message}`);
      }
      return null;
    }
  }

  /**
   * 重排序 — 对搜索结果重新排序，把最相关的排前面
   */
  async rerank(query: string, documents: string[]): Promise<number[] | null> {
    if (!this.available || documents.length === 0) return null;

    try {
      const baseUrl = this.rerankBaseUrl.replace(/\/+$/, '');
      const response = await axios.post(
        `${baseUrl}/rerank`,
        { model: this.rerankModel, query, documents },
        { timeout: 30000 },
      );

      const results = response.data?.results;
      if (Array.isArray(results)) {
        return results
          .sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0))
          .map((r: any) => r.index);
      }
      return null;
    } catch (e: any) {
      this.logger.error(`Infinity rerank error: ${e.message}`);
      return null;
    }
  }

  // ===== Stub methods for AiProviderInstance interface =====
  // Infinity 只做 embedding/rerank，不需要文本生成和 key 管理

  async generateText(_prompt: string, _options?: Record<string, any>): Promise<string | null> {
    return null;
  }

  isAvailable(): boolean {
    return this.available;
  }

  getUsageStats(): AiProviderUsageStats {
    return {
      name: this.name,
      displayName: this.displayName,
      activeModel: this.activeModel,
      activeKeyIndex: this.activeKeyIndex,
      keys: [],
    };
  }

  rotateToNextKey(): boolean {
    return false;
  }

  resetDailyCounters(): void {
    // no-op
  }

  unblockExpiredKeys(_now: number): void {
    // no-op
  }
}
