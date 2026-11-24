/* eslint-disable @typescript-eslint/unbound-method -- 测试里把 spy 方法当值传给 expect，不存在 this 绑定风险 */
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { OllamaProvider } from './ollama.provider';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function build(config: Record<string, string | undefined>): OllamaProvider {
  const configService = {
    get: jest.fn((key: string, defaultValue?: string) =>
      key in config ? config[key] : defaultValue,
    ),
  } as unknown as ConfigService;
  return new OllamaProvider(configService);
}

describe('OllamaProvider.rerank · 降级行为', () => {
  const baseConfig = { AI_OLLAMA_BASE_URL: 'http://ollama.local:11434' };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('未配置 RERANK_BASE_URL → 返回 null，不走 embedding 余弦兜底', async () => {
    // E-11：embedding 余弦和 cross-encoder 分数不同量纲，
    // 拿它冒充 rerank 会让相关性门卫把离题问题全部放行（负样本 20/20 泄漏）。
    const provider = build(baseConfig);
    const embeddingSpy = jest.spyOn(provider, 'generateEmbedding');

    const result = await provider.rerank('query', ['doc a', 'doc b']);

    expect(result).toBeNull();
    expect(embeddingSpy).not.toHaveBeenCalled();
  });

  it('配置了 RERANK_BASE_URL 但专用服务失败 → 返回 null，交由调用方走 RRF', async () => {
    const provider = build({
      ...baseConfig,
      RERANK_BASE_URL: 'http://rerank.local',
      RERANK_MODEL: 'BAAI/bge-reranker-v2-m3',
    });
    const embeddingSpy = jest.spyOn(provider, 'generateEmbedding');
    mockedAxios.post.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    const result = await provider.rerank('query', ['doc a']);

    expect(result).toBeNull();
    expect(embeddingSpy).not.toHaveBeenCalled();
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'http://rerank.local/rerank',
      expect.objectContaining({ query: 'query', documents: ['doc a'] }),
      expect.anything(),
    );
  });

  it('专用 reranker 正常返回 → 透传 relevance_score', async () => {
    const provider = build({
      ...baseConfig,
      RERANK_BASE_URL: 'http://rerank.local',
      RERANK_MODEL: 'BAAI/bge-reranker-v2-m3',
    });
    mockedAxios.post.mockResolvedValueOnce({
      data: { results: [{ index: 1, relevance_score: 0.87 }] },
    });

    const result = await provider.rerank('query', ['doc a', 'doc b']);

    expect(result).toEqual([{ index: 1, relevance_score: 0.87 }]);
  });
});
