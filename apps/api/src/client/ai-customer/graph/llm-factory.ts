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
 * ── 是什么？ ──
 * Factory Pattern（工厂模式）。传入配置，返回 LLM 实例。
 * type=online → ChatOpenAI（DeepSeek/OpenAI API，推理强响应快）
 * type=local → ChatOllama（本地，免费离线）
 *
 * ── 为什么需要 Factory Pattern？ ──
 * 1. 切换成本低：开发用 Ollama（免费、离线、快），生产用 ChatOpenAI（更聪明）
 * 2. 统一入口：所有 Agent 都通过这个函数创建 LLM，配置改一处就行
 * 3. 关注点分离：Agent 不需要关心"你用的是哪个提供商"，只需要一个 LLM 实例
 *
 * ── 生活类比 ──
 * 就像你家的插座转换器：你去不同国家（开发/生产），只需要换一个插头（改 config.type），
 * 电器（你的代码）不用动。ChatOpenAI 是美标插头，ChatOllama 是欧标插头，
 * createLLM 就是那个万能转换器。
 *
 * ── 怎么做？ ──
 * const model = createLLM(config, { temperature: 0 });
 * // config = { type: 'online', model: 'deepseek-chat', baseURL: '...', apiKey: '...' }
 * // 或 config = { type: 'local', model: 'qwen3.5:0.8b', baseURL: 'http://localhost:11434' }
 */
export function createLLM(
  config: LlmProviderConfig,
  options: { temperature?: number } & Partial<LlmProviderConfig>,
) {
  if (config.type === 'online') {
    return new ChatOpenAI({
      model: config.model,
      temperature: options.temperature ?? 0,
      // 流式模式下让 provider 在最后一条 chunk 带 usage，
      // 否则 usage_metadata 永远是 undefined，token 统计全为 0（#89 FR-4）
      streamUsage: true,
      // ── 为什么要 timeout？(#87 N-15) ──
      // 不设的话，provider 卡住时这个请求会一直挂着：
      // 用户既收不到回复、也收不到错误，只能等客户端自己超时。
      // 15s 是"单次模型调用"的量级，整轮（多 agent）由上层兜。
      timeout: 15000,
      // 网络抖动重试一次就够。重试本身有延迟，
      // 客服场景里"退给人工"比"无限重试、让用户干等"更合理。
      maxRetries: 1,
      configuration: {
        baseURL: config.baseURL,
      },
      apiKey: config.apiKey,
    });
  }
  // fallback: ollama（本地）
  return new ChatOllama({
    model: config.model,
    temperature: options.temperature ?? 0,
    baseUrl: config.baseURL,
  });
}
