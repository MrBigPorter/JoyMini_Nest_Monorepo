import { ChatOpenAI } from '@langchain/openai';
import { ChatOllama } from '@langchain/ollama';

// 配置定义
export interface LlmProviderConfig {
  type: 'online' | 'local'; // online=ChatOpenAI, local=ChatOllama
  model: string;
  baseURL?: string; // online 用 baseURL, local 用 baseUrl
  apiKey?: string; // online 需要, local 不需要
}

/**
 * LLM Factory — 根据配置创建本地或云端模型
 *
 * type=online  → ChatOpenAI (DeepSeek/OpenAI API, 推理强响应快)
 * type=local   → ChatOllama (本地, 免费离线)
 * 默认: local (qwen3.5:0.8b)
 */

export function createLLM(
  config: LlmProviderConfig,
  options: { temperature?: number } & Partial<LlmProviderConfig>,
) {
  if (config.type === 'online') {
    return new ChatOpenAI({
      model: config.model,
      temperature: options.temperature ?? 0,
      configuration: {
        baseURL: config.baseURL,
      },
      apiKey: config.apiKey,
    });
  }
  // fallback: ollama (本地)
  return new ChatOllama({
    model: config.model,
    temperature: options.temperature ?? 0,
    baseUrl: config.baseURL,
  });
}
