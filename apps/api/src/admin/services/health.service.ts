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
    const [ollama, unstructured, meilisearch, infinity] = await Promise.all([
      this.checkOllama(),
      this.checkUnstructured(),
      this.checkMeilisearch(),
      this.checkInfinity(),
    ]);
    return [ollama, unstructured, meilisearch, infinity];
  }

  private async checkOllama(): Promise<ServiceHealth> {
    const baseURL =
      this.configService.get<string>('AI_OLLAMA_BASE_URL') ||
      'http://joymini-ollama:11434';
    try {
      const res = await axios.get(`${baseURL}/api/tags`, { timeout: 3000 });
      const models: string[] = res.data?.models?.map((m: any) => m.name) ?? [];
      return {
        name: 'ollama',
        available: models.length > 0,
        label: 'Ollama',
        description: '向量嵌入 (bge-m3) + LLM 推理',
        details: { models, url: baseURL },
      };
    } catch {
      return {
        name: 'ollama',
        available: false,
        label: 'Ollama',
        description: '向量嵌入 (bge-m3) + LLM 推理',
        details: { error: '连接失败', url: baseURL },
      };
    }
  }

  private async checkUnstructured(): Promise<ServiceHealth> {
    const url =
      this.configService.get<string>('UNSTRUCTURED_URL') ||
      'http://joymini-unstructured:8000';
    try {
      await axios.get(`${url}/health`, { timeout: 3000 });
      return {
        name: 'unstructured',
        available: true,
        label: 'Unstructured',
        description: 'PDF 解析 (OCR/表格/多栏)',
        details: { url },
      };
    } catch {
      return {
        name: 'unstructured',
        available: false,
        label: 'Unstructured',
        description: 'PDF 解析 (OCR/表格/多栏)',
        details: {
          error: '未启动',
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
        description: 'BM25 关键词搜索',
        details: { available },
      };
    } catch {
      return {
        name: 'meilisearch',
        available: false,
        label: 'Meilisearch',
        description: 'BM25 关键词搜索',
        details: { error: '不可用' },
      };
    }
  }

  private async checkInfinity(): Promise<ServiceHealth> {
    const url =
      this.configService.get<string>('RERANK_BASE_URL') ||
      'http://joymini-infinity:7997';
    try {
      const res = await axios.get(`${url}/health`, { timeout: 3000 });
      return {
        name: 'infinity',
        available: res.status === 200,
        label: 'Infinity',
        description: 'Rerank 重排序 (bge-reranker-v2-m3)',
        details: { url },
      };
    } catch {
      return {
        name: 'infinity',
        available: false,
        label: 'Infinity',
        description: 'Rerank 重排序 (bge-reranker-v2-m3)',
        details: {
          error: '未启动',
          hint: 'make start-infinity',
          url,
        },
      };
    }
  }
}
