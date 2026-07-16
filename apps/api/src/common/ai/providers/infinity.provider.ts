import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AiProviderInstance, AiKeyInstance, AiProviderUsageStats } from '../interfaces/ai-provider.interface';

/**
 * InfinityProvider — 专用 Embedding 引擎（bge-m3）
 *
 * 只做 embedding（向量化），reranker 继续走 Jina AI 线上 API。
 * 比 Ollama 跑 bge-m3 更轻更快，调用 /embeddings 接口（OpenAI 兼容格式）。
 *
 * 生活类比：从「大厨房（Ollama）」的化验室搬到「专业检测中心（Infinity）」。
 *   同一个化验员（bge-m3），但设备更专业、占地方更小。
 */
@Injectable()
export class InfinityProvider implements AiProviderInstance {
  private readonly logger = new Logger(InfinityProvider.name);
  readonly name = 'infinity';
  readonly displayName = 'Infinity';
  readonly models = ['BAAI/bge-m3'];
  activeModel = 'BAAI/bge-m3';
  keys: AiKeyInstance[] = [];
  activeKeyIndex = 0;
  available = false;

  private embedBaseUrl: string;
  private embedModel: string;

  constructor(private configService: ConfigService) {
    this.embedBaseUrl = this.configService.get<string>(
      'INFINITY_EMBEDDING_BASE_URL',
      'http://joymini-infinity:7997',
    );
    this.embedModel = this.configService.get<string>(
      'INFINITY_EMBEDDING_MODEL',
      'BAAI/bge-m3',
    );
    this.available = !!this.configService.get('INFINITY_EMBEDDING_BASE_URL');
  }

  /**
   * 文本向量化 — 把文字转成 1024 维向量
   *
   * 调用 Infinity 的 /embeddings 接口（OpenAI 兼容格式）
   *
   * @param text 要向量化的文本
   * @param options 可选参数（兼容 AiService 调用方）
   * @returns 1024 维向量数组，失败返回 null
   */
  async generateEmbedding(
    text: string,
    _options?: { task?: string },
  ): Promise<number[] | null> {
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

  // ===== Stub methods for AiProviderInstance interface =====
  // Infinity 只做 embedding，不需要文本生成和 key 管理
  // 注意：没有 rerank() 方法 — 让 duck-typing 自动走到 JinaProvider 的 rerank

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
