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
 * OllamaProvider — AI 模型提供者（Ollama / DeepSeek 兼容层）
 *
 * ═══════════════════════════════════════════════════════════════
 * 🏪 餐厅类比：OllamaProvider = 厨房的「炉灶区」
 * ═══════════════════════════════════════════════════════════════
 *
 * 整个 AiService 就像一家餐厅的后厨：
 * ┌─────────────────────────────────────────────────────┐
 * │  AiService (餐厅经理)                                │
 * │  ├─ OllamaProvider (炉灶区 — 本地 Ollama)            │
 * │  │   ├─ generateText()       = 炒菜（文本生成）       │
 * │  │   ├─ generateEmbedding()  = 食材化验（向量化）     │
 * │  │   └─ rerank()             = 菜品品鉴师（重排序）   │
 * │  ├─ DeepSeekProvider (另一个炉灶区 — 云端 API)        │
 * │  └─ ...其他 Provider                                 │
 * └─────────────────────────────────────────────────────┘
 *
 * 【generateEmbedding】= 食材化验员
 *   把一段文字（食材）送进 embedding 模型（化验仪器），
 *   返回一串数字向量（化验报告单）。
 *   模型名由 OLLAMA_EMBEDDING_MODEL 环境变量控制（默认 bge-m3）。
 *   这份报告单会被 IntentClassifier 拿去和数据库里的
 *   标准报告单做比对，判断用户想做什么（意图分类）。
 *
 * 【rerank】= 菜品品鉴师
 *   把检索到的候选 chunks（几道候选菜）和用户问题（顾客口味）
 *   一起送进 reranker 模型，重新打分排序。
 *   模型名由 OLLAMA_RERANK_MODEL 环境变量控制。
 *   比 embedding 余弦相似度更准确，但速度更慢（交叉编码）。
 *
 * 【generateText】= 厨师炒菜
 *   接收 prompt（菜单），调用 LLM 模型（大厨），
 *   返回生成的文本（做好的菜）。
 *
 * 【超时问题 — 为什么需要 BullMQ 队列】
 *   单个 embedding 请求约 5 秒（化验一道菜 5 分钟）。
 *   如果一次来 30 个请求（30 道菜同时要化验），
 *   串行处理 = 30 × 5s = 150s > 120s（API 超时）。
 *   解决方案：用 BullMQ 队列（取号系统），
 *   设置 concurrency: 2（同时开 2 台化验仪器），
 *   既不会挤爆 Ollama，也不会让 API 超时。
 *
 *   详见 docs/AI-joymini/56-BullMQ-Queue-Explanation.md
 *
 * ═══════════════════════════════════════════════════════════════
 */
@Injectable()
export class OllamaProvider implements AiProviderInstance {
  readonly name = 'ollama';
  readonly displayName = 'Ollama (OpenAI-compatible)';
  readonly models = ['qwen3.5:0.8b', 'bge-m3', 'deepseek-chat'];
  activeModel = 'qwen3.5:0.8b';

  keys: AiKeyInstance[] = [];
  activeKeyIndex = 0;

  private readonly logger = new Logger(OllamaProvider.name);
  private baseUrl = '';
  private available = false;
  private apiKey = '';
  private isExternalApi = false;

  // Ollama local instance: no daily limit, simplified key tracking
  private readonly DAILY_LIMIT = 999_999_999_999;

  constructor(private configService: ConfigService) {
    this.initialize();
  }

  /**
   * 初始化炉灶区
   *
   * 🏪 类比：餐厅开业前检查炉灶
   * - AI_OLLAMA_BASE_URL = 炉灶的天然气管道接口
   * - OLLAMA_MODEL = 今天用哪口锅（qwen3.5 / deepseek-chat）
   * - DEEPSEEK_API_KEY = 如果接的是外部燃气公司（DeepSeek API），需要认证
   *
   * 两种模式：
   * 1. 本地模式（isExternalApi=false）：用自己的 Ollama 服务，免费但慢
   * 2. 外部模式（isExternalApi=true）：用 DeepSeek/OpenAI API，付费但快
   */
  private initialize() {
    const baseUrl = this.configService.get<string>('AI_OLLAMA_BASE_URL');
    const model = this.configService.get<string>('OLLAMA_MODEL');
    const apiKey = this.configService.get<string>('DEEPSEEK_API_KEY');

    if (!baseUrl) {
      this.logger.log('Ollama base URL not configured, provider disabled');
      return;
    }

    this.baseUrl = `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
    this.apiKey = apiKey ?? '';

    if (model) {
      this.activeModel = model;
    }

    // Detect external API (DeepSeek, OpenAI-compatible) vs local Ollama
    this.isExternalApi = this.apiKey.length > 0;

    const keySuffix = this.isExternalApi
      ? this.apiKey.substring(0, 8) + '...'
      : 'local';

    this.keys = [
      {
        keySuffix,
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
      `🟢 Ollama provider initialized (model: ${this.activeModel}, url: ${this.baseUrl}${this.isExternalApi ? ', auth: Bearer' : ', no auth'})`,
    );
  }

  /**
   * Generate vector embedding for the given text.
   *
   * 🏪 餐厅类比：食材化验员
   * ────────────────────────────────────────────────────────────
   * 输入：一段文字（食材样本，比如 "退款政策是什么？"）
   * 过程：送进 embedding 化验仪器（Ollama /api/embeddings）
   * 输出：一串数字向量（化验报告单，1024 维）
   *
   * 模型名由 OLLAMA_EMBEDDING_MODEL 环境变量控制（默认 bge-m3）。
   *
   * 这份化验报告单会被 IntentClassifier 拿去和数据库里的
   * 标准报告单做比对，判断用户想做什么（意图分类）。
   *
   * 【超时说明】
   * 单个化验耗时约 5 秒（bge-m3 在本地 GPU 上跑）。
   * 如果同时来 30 个样本，串行处理 = 150 秒。
   * 这就是为什么需要 BullMQ 队列来控制并发数，
   * 避免 API 网关超时（120 秒限制）。
   *
   * 【技术细节】
   * 使用 Ollama 原生 embedding API：
   *   POST {baseUrl}/api/embeddings
   *   { "model": "<OLLAMA_EMBEDDING_MODEL>", "prompt": "text" }
   *
   * @param text 要向量化的文本（食材样本）
   * @returns 1024 维向量数组（化验报告单），失败返回 null
   */
  async generateEmbedding(text: string): Promise<number[] | null> {
    if (!this.available) return null;

    try {
      // Use dedicated embedding URL if configured, otherwise derive from text-gen URL
      // OLLAMA_EMBEDDING_BASE_URL → local Ollama (bge-m3)
      // AI_OLLAMA_BASE_URL → DeepSeek API (text generation only)
      const embedBaseUrl =
        this.configService.get<string>('OLLAMA_EMBEDDING_BASE_URL') ??
        this.baseUrl.replace('/v1/chat/completions', '');
      const url = `${embedBaseUrl.replace(/\/+$/, '')}/api/embeddings`;

      const response = await axios.post(
        url,

        {
          model: this.configService.get<string>('OLLAMA_EMBEDDING_MODEL', 'bge-m3'),
          prompt: text,
        },
        {
          timeout: 120000, // 120 秒超时 — 首次加载模型(~30s) + 推理
        },
      );

      const embedding = response.data?.embedding;

      if (Array.isArray(embedding) && embedding.length > 0) {
        const currentKey = this.keys[this.activeKeyIndex];
        if (currentKey) {
          currentKey.dailyRequests++;
        }
        return embedding as number[];
      }

      this.logger.warn('Ollama embedding returned empty result');
      return null;
    } catch (e: any) {
      if (e.code === 'ECONNREFUSED') {
        this.logger.warn(
          `Ollama connection refused for embedding at ${this.baseUrl} — is the Ollama service running?`,
        );
        this.available = false;
      } else if (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT') {
        this.logger.warn('Ollama embedding request timed out');
      } else {
        this.logger.error(`Ollama embedding API error: ${e.message}`);
      }

      return null;
    }
  }

  /**
   * Generate text using the LLM model.
   *
   * 🏪 餐厅类比：厨师炒菜
   * ────────────────────────────────────────────────────────────
   * 输入：prompt（菜单）+ systemPrompt（餐厅规矩）
   * 过程：调用 LLM 模型（大厨根据菜单和规矩做菜）
   * 输出：生成的文本（做好的菜）
   *
   * 【两种模式】
   * 1. 本地模式（isExternalApi=false）：
   *    - 用自己的 Ollama 服务，免费
   *    - 超时 120 秒（本地模型可能较慢）
   * 2. 外部模式（isExternalApi=true）：
   *    - 用 DeepSeek/OpenAI API，付费
   *    - 超时 30 秒（云端 API 响应快）
   *    - 需要 Bearer token 认证
   *
   * @param prompt 用户输入的提示词（菜单）
   * @param options 生成选项（温度、最大 token 数等 = 口味偏好）
   * @returns 生成的文本（做好的菜），失败返回 null
   */
  async generateText(
    prompt: string,
    options?: AiGenerationOptions,
  ): Promise<string | null> {
    if (!this.available) return null;

    const currentKey = this.keys[this.activeKeyIndex];

    if (!currentKey) return null;

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Add Bearer auth for external APIs (DeepSeek, OpenAI-compatible)
      if (this.isExternalApi && this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

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
          headers,
          timeout: this.isExternalApi ? 30000 : 120000, // 30s for external API, 120s for local
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

  /**
   * Rerank candidate chunks using a cross-encoder model.
   *
   * 🏪 餐厅类比：菜品品鉴师
   * ────────────────────────────────────────────────────────────
   * 输入：
   *   - query: 用户问题（顾客口味偏好）
   *   - documents: 候选 chunks（几道候选菜）
   * 过程：送进 reranker 模型（品鉴师逐一品尝对比）
   * 输出：重新打分排序的结果（品鉴师的推荐排名）
   *
   * 模型名由 OLLAMA_RERANK_MODEL 环境变量控制。
   * 默认使用 qllama/bge-reranker-v2-m3:q4_k_m（社区版，~1.2GB）。
   *
   * 比 embedding 余弦相似度更准确，因为 reranker 是交叉编码器，
   * 能同时看到 query 和 document 的完整语义。
   *
   * 【重排序策略】
   * 1. RERANK_BASE_URL 环境变量 → Infinity / TEI 等专用 rerank 服务
   *    POST {rerankBaseUrl}/v1/rerank  (Cohere 兼容格式)
   * 2. 无 RERANK_BASE_URL 时 → Embedding 余弦相似度降级（兜底）
   *
   * @param query 用户问题原文
   * @param documents 候选文本列表（chunk contents）
   * @returns 重排序结果数组，每项包含 index 和 relevance_score，失败返回 null
   */
  async rerank(
    query: string,
    documents: string[],
  ): Promise<Array<{ index: number; relevance_score: number }> | null> {
    if (!this.available) return null;
    if (documents.length === 0) return [];

    // 1) Try dedicated rerank service (Infinity / TEI) if configured via RERANK_BASE_URL
    const rerankBaseUrl = this.configService.get<string>('RERANK_BASE_URL');
    if (rerankBaseUrl) {
      const rerankResult = await this.tryDedicatedRerank(
        rerankBaseUrl.replace(/\/+$/, ''),
        query,
        documents,
      );
      if (rerankResult !== null) return rerankResult;
      this.logger.warn(
        '[rerank] Dedicated rerank failed (check RERANK_BASE_URL / endpoint), falling back to embedding-based reranking',
      );
    } else {
      this.logger.warn(
        '[rerank] No RERANK_BASE_URL configured, falling back to embedding-based reranking',
      );
    }

    // 2) Fallback: embedding-based reranking via cosine similarity
    const embedBaseUrl =
      this.configService.get<string>('OLLAMA_EMBEDDING_BASE_URL') ??
      this.baseUrl.replace('/v1/chat/completions', '');
    const baseUrl = embedBaseUrl.replace(/\/+$/, '');
    return this.embeddingRerankFallback(baseUrl, query, documents);
  }

  /**
   * Try dedicated rerank service (Infinity / TEI) via /rerank endpoint.
   * Uses Cohere-compatible request/response format.
   *
   * Infinity v2 endpoint: POST {baseUrl}/rerank
   *   Request:  { "model": "...", "query": "...", "documents": [...] }
   *   Response: { "results": [{ "index": 0, "relevance_score": 0.95 }, ...] }
   *
   * Returns null if the endpoint is not available or any error occurs.
   */
  private async tryDedicatedRerank(
    baseUrl: string,
    query: string,
    documents: string[],
  ): Promise<Array<{ index: number; relevance_score: number }> | null> {
    try {
      const url = `${baseUrl}/rerank`;
      const model = this.configService.get<string>(
        'RERANK_MODEL',
        'BAAI/bge-reranker-v2-m3',
      );

      const response = await axios.post(
        url,
        { model, query, documents },
        { timeout: 30000 },
      );

      const results = response.data?.results;

      if (Array.isArray(results) && results.length > 0) {
        const currentKey = this.keys[this.activeKeyIndex];
        if (currentKey) currentKey.dailyRequests++;
        this.logger.log(
          `[rerank] Dedicated reranker (${model}) re-ranked ${documents.length} documents → ${results.length} results`,
        );
        return results as Array<{ index: number; relevance_score: number }>;
      }

      this.logger.warn('[rerank] Dedicated reranker returned empty results');
      return [];
    } catch (e: any) {
      if (e.code === 'ECONNREFUSED') {
        this.logger.warn(
          `Dedicated rerank service connection refused at ${baseUrl} — is the service running?`,
        );
        return null;
      }
      if (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT') {
        this.logger.warn('Dedicated rerank request timed out');
        return null;
      }
      this.logger.error(`Dedicated rerank API error: ${e.message}`);
      return null;
    }
  }

  /**
   * Try native Ollama /api/rerank endpoint.
   * Returns null if the endpoint is not available (404) or any other error.
   */
  private async tryNativeRerank(
    baseUrl: string,
    query: string,
    documents: string[],
  ): Promise<Array<{ index: number; relevance_score: number }> | null> {
    try {
      const url = `${baseUrl}/api/rerank`;
      const model = this.configService.get<string>(
        'OLLAMA_RERANK_MODEL',
        'qllama/bge-reranker-v2-m3:q4_k_m',
      );

      const response = await axios.post(
        url,
        { model, query, documents },
        { timeout: 30000 },
      );

      const results = response.data?.results;

      if (Array.isArray(results) && results.length > 0) {
        const currentKey = this.keys[this.activeKeyIndex];
        if (currentKey) currentKey.dailyRequests++;
        this.logger.log(
          `[rerank] ${model} re-ranked ${documents.length} documents → ${results.length} results`,
        );
        return results as Array<{ index: number; relevance_score: number }>;
      }

      this.logger.warn('[rerank] Native reranker returned empty results');
      return [];
    } catch (e: any) {
      if (e.response?.status === 404) {
        // Endpoint not available (ARM64 build) — signal fallback
        return null;
      }
      if (e.code === 'ECONNREFUSED') {
        this.logger.warn(
          `Ollama connection refused for rerank at ${baseUrl} — is the Ollama service running?`,
        );
        this.available = false;
        return null;
      }
      if (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT') {
        this.logger.warn('Ollama rerank request timed out');
        return null;
      }
      this.logger.error(`Ollama rerank API error: ${e.message}`);
      return null;
    }
  }

  /**
   * Fallback reranking using embedding cosine similarity.
   * Embeds the query and all documents via /api/embed, then computes
   * cosine similarity between query embedding and each document embedding.
   */
  private async embeddingRerankFallback(
    baseUrl: string,
    query: string,
    documents: string[],
  ): Promise<Array<{ index: number; relevance_score: number }> | null> {
    try {
      const model = this.configService.get<string>(
        'OLLAMA_EMBEDDING_MODEL',
        'bge-m3',
      );
      const url = `${baseUrl}/api/embed`;

      // Embed query
      const queryRes = await axios.post(
        url,
        { model, input: [query] },
        { timeout: 30000 },
      );
      const queryEmbedding = queryRes.data?.embeddings?.[0];
      if (!queryEmbedding) {
        this.logger.warn('[rerank] Failed to get query embedding for fallback');
        return null;
      }

      // Embed all documents in one batch
      const docsRes = await axios.post(
        url,
        { model, input: documents },
        { timeout: 60000 },
      );
      const docEmbeddings = docsRes.data?.embeddings;
      if (!Array.isArray(docEmbeddings) || docEmbeddings.length !== documents.length) {
        this.logger.warn('[rerank] Failed to get document embeddings for fallback');
        return null;
      }

      // Compute cosine similarity for each document
      const results = docEmbeddings.map((docEmb: number[], idx: number) => ({
        index: idx,
        relevance_score: this.cosineSimilarity(queryEmbedding, docEmb),
      }));

      // Sort by relevance score descending
      results.sort((a, b) => b.relevance_score - a.relevance_score);

      const currentKey = this.keys[this.activeKeyIndex];
      if (currentKey) currentKey.dailyRequests++;

      this.logger.log(
        `[rerank] Embedding fallback (${model}) re-ranked ${documents.length} documents → ${results.length} results ` +
          `(top score: ${results[0]?.relevance_score.toFixed(4) ?? 'N/A'})`,
      );

      return results;
    } catch (e: any) {
      if (e.code === 'ECONNREFUSED') {
        this.logger.warn(
          `Ollama connection refused for embedding fallback at ${baseUrl}`,
        );
        this.available = false;
      } else {
        this.logger.error(`Ollama embedding fallback error: ${e.message}`);
      }
      return null;
    }
  }

  /**
   * Compute cosine similarity between two vectors.
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
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
