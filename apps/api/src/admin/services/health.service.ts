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
    const [ollamaEmbed, deepseekLlm, unstructured, meilisearch, infinity] =
      await Promise.all([
        this.checkOllamaEmbedding(),
        this.checkDeepSeekLLM(),
        this.checkUnstructured(),
        this.checkMeilisearch(),
        this.checkInfinity(),
      ]);
    return [ollamaEmbed, deepseekLlm, unstructured, meilisearch, infinity];
  }

  /**
   * 检查本地 Ollama 嵌入服务（bge-m3 模型）
   * 用于: 意图分类 + RAG 向量检索
   * URL: http://joymini-ollama:11434
   */
  private async checkOllamaEmbedding(): Promise<ServiceHealth> {
    const url = 'http://joymini-ollama:11434';
    try {
      const res = await axios.get(`${url}/api/tags`, { timeout: 3000 });
      const models: string[] =
        res.data?.models?.map((m: any) => m.name) ?? [];
      return {
        name: 'ollama',
        available: models.length > 0,
        label: 'Ollama',
        description: 'Embedding (bge-m3)',
        details: { models, url },
      };
    } catch {
      return {
        name: 'ollama',
        available: false,
        label: 'Ollama',
        description: 'Embedding (bge-m3)',
        details: { error: 'Not started', hint: 'make start-ollama', url },
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

  private async checkInfinity(): Promise<ServiceHealth> {
    const url =
      this.configService.get<string>('RERANK_BASE_URL') ||
      'http://joymini-infinity:7997';
    try {
      await axios.get(`${url}/health`, { timeout: 3000 });
      return {
        name: 'infinity',
        available: true,
        label: 'Infinity',
        description: 'Rerank (bge-reranker-v2-m3)',
        details: { url },
      };
    } catch {
      return {
        name: 'infinity',
        available: false,
        label: 'Infinity',
        description: 'Rerank (bge-reranker-v2-m3)',
        details: {
          error: 'Not started',
          hint: 'make start-infinity',
          url,
        },
      };
    }
  }
}
