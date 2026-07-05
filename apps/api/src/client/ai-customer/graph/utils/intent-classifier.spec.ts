/**
 * IntentClassifier — 单元测试（Phase 2: pgvector）
 *
 * 测试范围:
 * 1. ensureSeeded() — 检查 DB 是否为空 → 空则写入 / 有数据则跳过
 * 2. classify() — 嵌入成功 → pgvector 查询 → 返回结果
 * 3. classify() — 嵌入失败 → llm_fallback
 * 4. classify() — 低置信度 → llm_fallback
 * 5. classify() — DB 为空 → llm_fallback
 */

import { AiService } from '@api/common/ai/ai.service';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { IntentClassifier } from './intent-classifier';

// ============================================================
// Mock 工具函数
// ============================================================

/**
 * 创建 mock AiService
 * - embeddingMap: 文字 → 向量的映射
 * - 如果 text 不在 map 中，返回 null
 */
function createMockAiService(
  embeddingMap: Map<string, number[]>,
): Partial<AiService> {
  return {
    generateEmbedding: jest.fn(async (text: string) => {
      return embeddingMap.get(text) ?? null;
    }),
  };
}

/**
 * 创建 mock PrismaService
 * - queryRawResults: SQL 查询返回的模拟数据
 *   key = SQL 前缀（如 'SELECT COUNT'），value = 返回的行
 * - executeRawUnsafe 默认返回 undefined（INSERT 无返回值）
 */
function createMockPrismaService(options: {
  /** mock $queryRaw 的返回值，key 为 SQL 前缀匹配 */
  queryRawResults?: Record<string, any[]>;
  /** mock $queryRawUnsafe 的返回值，key 为 SQL 前缀匹配 */
  queryRawUnsafeResults?: Record<string, any[]>;
}): Partial<PrismaService> {
  const { queryRawResults = {}, queryRawUnsafeResults = {} } = options;

  return {
    // $queryRaw: 模板字符串形式，匹配 SQL 前缀
    $queryRaw: jest.fn(async (sql: TemplateStringsArray) => {
      const sqlStr = sql.join('');
      for (const [prefix, result] of Object.entries(queryRawResults)) {
        if (sqlStr.includes(prefix)) return result;
      }
      return [];
    }) as any,

    // $queryRawUnsafe: 字符串参数形式
    $queryRawUnsafe: jest.fn(async (sql: string, ..._args: any[]) => {
      for (const [prefix, result] of Object.entries(queryRawUnsafeResults)) {
        if (sql.includes(prefix)) return result;
      }
      return [];
    }) as any,

    // $executeRawUnsafe: INSERT，无返回值
    $executeRawUnsafe: jest.fn(async () => undefined) as any,
  };
}

// ============================================================
// IntentClassifier
// ============================================================

describe('IntentClassifier', () => {
  // ── ensureSeeded ──

  describe('ensureSeeded', () => {
    it('should skip seeding when DB already has data', async () => {
      // Mock: DB 已有 61 行数据
      const prismaMock = createMockPrismaService({
        queryRawResults: {
          'SELECT COUNT': [{ count: 61 }],
        },
      });
      const prismaService = prismaMock as PrismaService;
      const queryRawSpy = prismaMock.$queryRaw as jest.Mock;
      const executeRawSpy = prismaMock.$executeRawUnsafe as jest.Mock;

      const aiService = createMockAiService(new Map()) as AiService;
      const classifier = new IntentClassifier(aiService, prismaService);

      await classifier.ensureSeeded();

      // 应该只调用了 COUNT 查询
      expect(queryRawSpy).toHaveBeenCalledTimes(1);
      // 不应该调用 $executeRawUnsafe（不需要插入）
      expect(executeRawSpy).not.toHaveBeenCalled();
    });

    it('should insert seed data when DB is empty', async () => {
      // Mock: DB 为空
      const prismaMock = createMockPrismaService({
        queryRawResults: {
          'SELECT COUNT': [{ count: 0 }],
        },
      });
      const prismaService = prismaMock as PrismaService;
      const queryRawSpy = prismaMock.$queryRaw as jest.Mock;
      const executeRawSpy = prismaMock.$executeRawUnsafe as jest.Mock;

      // Mock embedding: 无论什么文字都返回 [1, 0, 0]
      const aiService = {
        generateEmbedding: jest.fn(async (_text: string) => [1, 0, 0]),
      } as unknown as AiService;

      const classifier = new IntentClassifier(aiService, prismaService);

      await classifier.ensureSeeded();

      // 应该调用了 COUNT 查询
      expect(queryRawSpy).toHaveBeenCalledTimes(1);
      // 应该调用了多次 $executeRawUnsafe（每行 INSERT 一次）
      expect(executeRawSpy).toHaveBeenCalled();
      // 每次 INSERT 的第一个参数应该是 INSERT INTO intent_examples
      const calls = executeRawSpy.mock.calls;
      for (const call of calls) {
        expect(call[0]).toContain('INSERT INTO intent_examples');
      }
    });

    it('should handle generateEmbedding failure gracefully', async () => {
      const prismaService = createMockPrismaService({
        queryRawResults: {
          'SELECT COUNT': [{ count: 0 }],
        },
      }) as PrismaService;

      // Mock embedding 始终返回 null（API 失败）
      const aiService = {
        generateEmbedding: jest.fn(async (_text: string) => null),
      } as unknown as AiService;

      const classifier = new IntentClassifier(aiService, prismaService);

      // 不应该抛出异常
      await expect(classifier.ensureSeeded()).resolves.toBeUndefined();
    });
  });

  // ── classify ──

  describe('classify', () => {
    it('should return correct intent based on pgvector query', async () => {
      const prismaService = createMockPrismaService({
        // ensureSeeded: DB 已有数据
        queryRawResults: {
          'SELECT COUNT': [{ count: 61 }],
        },
        // classify: pgvector 返回 order 域，相似度 0.94
        queryRawUnsafeResults: {
          'SELECT domain': [
            { domain: 'order', similarity: 0.94 },
          ],
        },
      }) as PrismaService;

      // Mock embedding: "我要查订单" → [0.1, 0.2, ...]
      const embeddingMap = new Map<string, number[]>();
      embeddingMap.set('我要查订单', [0.1, 0.2, 0.3]);
      const aiService = createMockAiService(embeddingMap) as AiService;

      const classifier = new IntentClassifier(aiService, prismaService);
      const result = await classifier.classify('我要查订单');

      expect(result.intent).toBe('order');
      expect(result.labels[0].label).toBe('order');
      expect(result.labels[0].score).toBe(0.94);
      expect(result.method).toBe('embedding');
    });

    it('should return llm_fallback when generateEmbedding returns null', async () => {
      const prismaService = createMockPrismaService({
        queryRawResults: {
          'SELECT COUNT': [{ count: 61 }],
        },
      }) as PrismaService;

      // Mock: 文字不在 map 中 → 返回 null
      const aiService = createMockAiService(new Map()) as AiService;
      const classifier = new IntentClassifier(aiService, prismaService);

      const result = await classifier.classify('hello');

      expect(result.method).toBe('llm_fallback');
      expect(result.intent).toBe('general');
    });

    it('should return llm_fallback when generateEmbedding returns empty array', async () => {
      const prismaService = createMockPrismaService({
        queryRawResults: {
          'SELECT COUNT': [{ count: 61 }],
        },
      }) as PrismaService;

      const embeddingMap = new Map<string, number[]>();
      embeddingMap.set('hello', []); // 空向量
      const aiService = createMockAiService(embeddingMap) as AiService;
      const classifier = new IntentClassifier(aiService, prismaService);

      const result = await classifier.classify('hello');

      expect(result.method).toBe('llm_fallback');
      expect(result.intent).toBe('general');
    });

    it('should return llm_fallback when pgvector query returns empty', async () => {
      const prismaService = createMockPrismaService({
        // ensureSeeded: DB 有数据
        queryRawResults: {
          'SELECT COUNT': [{ count: 61 }],
        },
        // classify: pgvector 返回空（表被人清空了）
        queryRawUnsafeResults: {
          'SELECT domain': [],
        },
      }) as PrismaService;

      const embeddingMap = new Map<string, number[]>();
      embeddingMap.set('test', [0.5, 0.5, 0.5]);
      const aiService = createMockAiService(embeddingMap) as AiService;

      const classifier = new IntentClassifier(aiService, prismaService);
      const result = await classifier.classify('test');

      expect(result.method).toBe('llm_fallback');
      expect(result.intent).toBe('general');
    });

    it('should return llm_fallback when confidence is below threshold', async () => {
      const prismaService = createMockPrismaService({
        queryRawResults: {
          'SELECT COUNT': [{ count: 61 }],
        },
        // pgvector 返回低置信度 0.32（< 0.5）
        queryRawUnsafeResults: {
          'SELECT domain': [
            { domain: 'general', similarity: 0.32 },
          ],
        },
      }) as PrismaService;

      const embeddingMap = new Map<string, number[]>();
      embeddingMap.set('嗯', [0.1, 0.1, 0.1]);
      const aiService = createMockAiService(embeddingMap) as AiService;

      const classifier = new IntentClassifier(aiService, prismaService);
      const result = await classifier.classify('嗯');

      // 低置信度 → method 应该为 llm_fallback
      expect(result.method).toBe('llm_fallback');
      expect(result.intent).toBe('general');
    });

    it('should round similarity to 2 decimal places', async () => {
      const prismaService = createMockPrismaService({
        queryRawResults: {
          'SELECT COUNT': [{ count: 61 }],
        },
        queryRawUnsafeResults: {
          'SELECT domain': [
            { domain: 'wallet', similarity: 0.923456 },
          ],
        },
      }) as PrismaService;

      const embeddingMap = new Map<string, number[]>();
      embeddingMap.set('提现', [0.9, 0.1, 0.0]);
      const aiService = createMockAiService(embeddingMap) as AiService;

      const classifier = new IntentClassifier(aiService, prismaService);
      const result = await classifier.classify('提现');

      // 0.923456 → 四舍五入到 0.92
      expect(result.labels[0].score).toBe(0.92);
    });
  });
});
