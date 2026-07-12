import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MeilisearchService } from '@api/common/meilisearch/meilisearch.service';
import axios from 'axios';

export interface ServiceHealth {
  name: string;
  available: boolean;
  label: string;
  description: string;
  details?: Record<string, any>;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly meilisearchService: MeilisearchService,
  ) {}

  async checkAll(): Promise<ServiceHealth[]> {
    const [jina, deepseekLlm, unstructured, meilisearch] =
      await Promise.all([
        this.checkJina(),
        this.checkDeepSeekLLM(),
        this.checkUnstructured(),
        this.checkMeilisearch(),
      ]);
    return [jina, deepseekLlm, unstructured, meilisearch];
  }

  /**
   * 检查 Jina AI 线上服务（替代本地 Infinity）
   * 用于: Embedding + Reranker
   * URL: https://api.jina.ai
   */
  private async checkJina(): Promise<ServiceHealth> {
    const apiKey = this.configService.get<string>('JINA_API_KEY', '');
    if (!apiKey) {
      return {
        name: 'jina',
        available: false,
        label: 'Jina AI',
        description: 'Embedding + Reranker',
        details: { error: 'JINA_API_KEY not configured' },
      };
    }
    try {
      const res = await axios.post(
        'https://api.jina.ai/v1/embeddings',
        { model: 'jina-embeddings-v3', input: 'health check', dimensions: 1 },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 5000,
        },
      );
      const ok = !!res.data?.data?.[0]?.embedding;
      return {
        name: 'jina',
        available: ok,
        label: 'Jina AI',
        description: 'Embedding + Reranker',
        details: { status: ok ? 'healthy' : 'unexpected_response' },
      };
    } catch (err: any) {
      return {
        name: 'jina',
        available: false,
        label: 'Jina AI',
        description: 'Embedding + Reranker',
        details: { error: err.message, hint: 'check JINA_API_KEY' },
      };
    }
  }

  /**
   * 检查 DeepSeek API（LLM 文本生成）
   * 用于: Agent 推理 + 对话生成
   * URL: 从环境变量读取（默认 https://api.deepseek.com）
   */
  private async checkDeepSeekLLM(): Promise<ServiceHealth> {
    const url =
      this.configService.get<string>('AI_OLLAMA_BASE_URL') ||
      'https://api.deepseek.com';
    try {
      await axios.get(url, { timeout: 3000 });
      return {
        name: 'deepseek',
        available: true,
        label: 'DeepSeek',
        description: 'LLM (Text Generation)',
        details: { url },
      };
    } catch {
      return {
        name: 'deepseek',
        available: false,
        label: 'DeepSeek',
        description: 'LLM (Text Generation)',
        details: { error: 'Connection failed', url },
      };
    }
  }

  private async checkUnstructured(): Promise<ServiceHealth> {
    const url =
      this.configService.get<string>('UNSTRUCTURED_URL') ||
      'http://joymini-unstructured:8000';
    try {
      await axios.get(url, { timeout: 3000 });
      return {
        name: 'unstructured',
        available: true,
        label: 'Unstructured',
        description: 'PDF Parser (OCR/Table/Multicolumn)',
        details: { url },
      };
    } catch (err: any) {
      const isRunning =
        err.code !== 'ECONNREFUSED' && err.code !== 'ECONNABORTED';
      return {
        name: 'unstructured',
        available: isRunning,
        label: 'Unstructured',
        description: 'PDF Parser (OCR/Table/Multicolumn)',
        details: isRunning
          ? { url, note: 'running (no standard health endpoint)' }
          : {
              error: 'Not started',
              hint: 'make start-unstructured',
              url,
            },
      };
    }
  }

  private async checkMeilisearch(): Promise<ServiceHealth> {
    try {
      const available = this.meilisearchService.isAvailable;
      return {
        name: 'meilisearch',
        available,
        label: 'Meilisearch',
        description: 'BM25 Keyword Search',
        details: { available },
      };
    } catch {
      return {
        name: 'meilisearch',
        available: false,
        label: 'Meilisearch',
        description: 'BM25 Keyword Search',
        details: { error: 'Unavailable' },
      };
    }
  }

  /**
   * ⏸️ Infinity Rerank 健康检查（已迁移到 Jina AI）
   * 保留代码供切回时使用
   */
  // private async checkInfinity(): Promise<ServiceHealth> {
  //   const url =
  //     this.configService.get<string>('RERANK_BASE_URL') ||
  //     'http://joymini-infinity:7997';
  //   try {
  //     await axios.get(`${url}/health`, { timeout: 3000 });
  //     return {
  //       name: 'infinity',
  //       available: true,
  //       label: 'Infinity',
  //       description: 'Rerank (bge-reranker-v2-m3)',
  //       details: { url },
  //     };
  //   } catch {
  //     return {
  //       name: 'infinity',
  //       available: false,
  //       label: 'Infinity',
  //       description: 'Rerank (bge-reranker-v2-m3)',
  //       details: {
  //         error: 'Not started',
  //         hint: 'make start-infinity',
  //         url,
  //       },
  //     };
  //   }
  // }
}
