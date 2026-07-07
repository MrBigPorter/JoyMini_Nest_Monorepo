/**
 * IntentClassifier -- 单元测试（Phase 2: pgvector + Phase 3b: hash cache）
 *
 * 测试范围:
 * 1. ensureSeeded() -- hash 匹配则跳过 / hash 不匹配则重新 seeding
 * 2. classify() -- 嵌入成功 -> pgvector 查询 -> 返回结果
 * 3. classify() -- 嵌入失败 -> llm_fallback
 * 4. classify() -- 低置信度 -> llm_fallback
 * 5. classify() -- DB 为空 -> llm_fallback
 */

import { createHash } from 'node:crypto';
import { AiService } from '@api/common/ai/ai.service';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { IntentClassifier } from './intent-classifier';
import { INTENT_EXAMPLE_GROUPS } from '../agents/prompts/intent-examples';

// ============================================================
// Mock 工具函数
// ============================================================

/**
 * 创建 mock AiService
 * - embeddingMap: 文字 -> 向量的映射
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
 *   key = SQL 前缀（如 'SELECT "configHash"'），value = 返回的行
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

    // $executeRawUnsafe: INSERT/DELETE，无返回值
    $executeRawUnsafe: jest.fn(async () => undefined) as any,
  };
}

/** 计算当前 INTENT_EXAMPLE_GROUPS 的 MD5（与实际代码一致） */
function computeCurrentHash(): string {
  return createHash('md5')
    .update(JSON.stringify(INTENT_EXAMPLE_GROUPS))
    .digest('hex');
}

// ============================================================
// IntentClassifier
// ============================================================

describe('IntentClassifier', () => {
  // -- ensureSeeded --

  describe('ensureSeeded', () => {
    it('should skip seeding when hash matches existing data', async () => {
      // Mock: DB 已有数据且 hash 匹配
      const fakeHash = computeCurrentHash();
      const prismaMock = createMockPrismaService({
        queryRawResults: {
          'SELECT "configHash"': [{ hash: fakeHash }],
        },
      });
      const prismaService = prismaMock as PrismaService;
      const queryRawSpy = prismaMock.$queryRaw as jest.Mock;
      const executeRawSpy = prismaMock.$executeRawUnsafe as jest.Mock;

      const aiService = createMockAiService(new Map()) as AiService;
      const classifier = new IntentClassifier(aiService, prismaService);

      await classifier.ensureSeeded();

      // 应该只调用了 configHash 查询
      expect(queryRawSpy).toHaveBeenCalledTimes(1);
      // 不应该调用任何 INSERT 或 DELETE
      expect(executeRawSpy).not.toHaveBeenCalled();
    });

    it('should insert seed data when DB is empty', async () => {
      // Mock: DB 为空
      const prismaMock = createMockPrismaService({
        queryRawResults: {
          'SELECT "configHash"': [],
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

      // 应该调用了 configHash 查询
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
          'SELECT "configHash"': [],
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

    it('should re-seed when config hash differs from existing data', async () => {
      const prismaMock = createMockPrismaService({
        queryRawResults: {
          'SELECT "configHash"': [{ hash: 'old-hash-value' }],
        },
      });
      const executeRawSpy = prismaMock.$executeRawUnsafe as jest.Mock;

      const aiService = {
        generateEmbedding: jest.fn(async (_text: string) => [1, 0, 0]),
      } as unknown as AiService;

      const classifier = new IntentClassifier(aiService, prismaMock as PrismaService);

      await classifier.ensureSeeded();

      // hash 不匹配 -> 应该先 DELETE 再 INSERT
      const deleteCall = executeRawSpy.mock.calls.find(
        (call: any[]) => call[0].includes('DELETE'),
      );
      expect(deleteCall).toBeDefined();

      const insertCalls = executeRawSpy.mock.calls.filter(
        (call: any[]) => call[0].includes('INSERT'),
      );
      expect(insertCalls.length).toBeGreaterThan(0);
    });

    it('should write configHash on every inserted row', async () => {
      const prismaMock = createMockPrismaService({
        queryRawResults: {
          'SELECT "configHash"': [],
        },
      });
      const executeRawSpy = prismaMock.$executeRawUnsafe as jest.Mock;

      const aiService = {
        generateEmbedding: jest.fn(async (_text: string) => [1, 0, 0]),
      } as unknown as AiService;

      const classifier = new IntentClassifier(aiService, prismaMock as PrismaService);

      await classifier.ensureSeeded();

      // 验证每个 INSERT 的最后一个参数是 configHash（32 位 MD5 hex）
      const insertCalls = executeRawSpy.mock.calls.filter(
        (call: any[]) => call[0].includes('INSERT'),
      );
      for (const call of insertCalls) {
        // call[0]=SQL, call[1]=id, call[2]=domain, call[3]=sentence, call[4]=vector, call[5]=hash
        expect(call[5]).toBeDefined();
        expect(typeof call[5]).toBe('string');
        expect(call[5].length).toBe(32); // MD5 hex = 32 chars
      }
    });
  });

  // -- classify --

  describe('classify', () => {
    it('should return correct intent based on pgvector query', async () => {
      const prismaService = createMockPrismaService({
        // ensureSeeded: DB 已有数据且 hash 匹配
        queryRawResults: {
          'SELECT "configHash"': [{ hash: computeCurrentHash() }],
        },
        // classify: pgvector 返回 order 域，相似度 0.94
        queryRawUnsafeResults: {
          'SELECT domain': [
            { domain: 'order', similarity: 0.94 },
          ],
        },
      }) as PrismaService;

      // Mock embedding: "我要查订单" -> [0.1, 0.2, ...]
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
          'SELECT "configHash"': [{ hash: computeCurrentHash() }],
        },
      }) as PrismaService;

      // Mock: 文字不在 map 中 -> 返回 null
      const aiService = createMockAiService(new Map()) as AiService;
      const classifier = new IntentClassifier(aiService, prismaService);

      const result = await classifier.classify('hello');

      expect(result.method).toBe('llm_fallback');
      expect(result.intent).toBe('general');
    });

    it('should return llm_fallback when generateEmbedding returns empty array', async () => {
      const prismaService = createMockPrismaService({
        queryRawResults: {
          'SELECT "configHash"': [{ hash: computeCurrentHash() }],
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
          'SELECT "configHash"': [{ hash: computeCurrentHash() }],
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
          'SELECT "configHash"': [{ hash: computeCurrentHash() }],
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

      // 低置信度 -> method 应该为 llm_fallback
      expect(result.method).toBe('llm_fallback');
      expect(result.intent).toBe('general');
    });

    it('should round similarity to 2 decimal places', async () => {
      const prismaService = createMockPrismaService({
        queryRawResults: {
          'SELECT "configHash"': [{ hash: computeCurrentHash() }],
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

      // 0.923456 -> 四舍五入到 0.92
      expect(result.labels[0].score).toBe(0.92);
    });
  });
});
