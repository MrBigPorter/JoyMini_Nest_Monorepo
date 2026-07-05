/**
 * IntentClassifier — 基于 pgvector 的意图分类器
 *
 * Phase 2: 迁移到 pgvector
 * - 域向量存入 intent_examples 表
 * - 使用 SQL `<=>` 运算符替代手动余弦相似度
 * - 冷启动自动 seeding：首次 classify() 检测 DB 空则自动写入
 *
 * ── 整体流程 ──
 * 1. 启动时：ensureSeeded() 检查数据库是否有示例数据
 *    如果没有，遍历 8 个 domain 共 61 个句子，调用 DeepSeek API 转成向量后存入数据库
 * 2. 分类时：classify() 先 ensureSeeded()，然后把用户输入也转成向量
 *    用 pgvector 的 <=> 运算符（余弦距离）找数据库里最匹配的句子
 *    如果匹配度 > 0.5 直接返回 domain，否则降级到 LLM
 */
import { AiService } from '@api/common/ai/ai.service';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { Logger } from '@nestjs/common';
import { INTENT_EXAMPLE_GROUPS } from '@api/client/ai-customer/graph/agents/prompts/intent-examples';
import { ToolRegistryService } from '@api/client/ai-customer/graph/tools/tool-registry.service';

const logger = new Logger('IntentClassifier');

/**
 * domain 名，如 'order'
 * 相似度 0~1，如 0.92
 */
export interface ClassifiedLabel {
  label: string;
  score: number;
}

export interface ClassificationResult {
  intent: string; // 最终选中的 domain（如 'order'）
  labels: ClassifiedLabel[]; // domain 和对应的分数
  method: 'embedding' | 'llm_fallback'; // embedding=向量匹配, llm_fallback=降级给 LLM
  /** debug=true 时返回原始 pgvector TOP-5 结果 */
  rawTop5?: { domain: string; similarity: number }[];
}

// ============================================================
// IntentClassifier
// ============================================================

export class IntentClassifier {
  /** 低置信度阈值：低于此值时使用 LLM fallback */
  private readonly LOW_CONFIDENCE_THRESHOLD = 0.5;

  constructor(
    private readonly aiService: AiService, // 用于 generateEmbedding() — 把文字转成向量
    private readonly prismaService: PrismaService, // 用于 pgvector SQL 查询
    private readonly toolRegistry?: ToolRegistryService, // 可选：用于检查哪些域有已注册的工具
  ) {}

  /**
   * 确保数据库已 seeding
   * - 检查 intent_examples 表是否为空
   * - 为空则从 INTENT_EXAMPLE_GROUPS 生成 embedding 并写入
   *
   * ── 为什么需要这个方法？ ──
   * 第一次部署时，数据库是空的，没有示例句子可以对比。
   * 这个方法在第一次 classify() 时自动把 61 个示例句子转成向量存入数据库。
   * 后续调用发现已有数据就直接跳过（幂等设计）。
   */
  async ensureSeeded(): Promise<void> {
    // ─── 第一步：检查数据库是否已有数据 ───
    // $queryRaw: 执行原生 SQL 查询（模板字符串形式，Prisma 自动处理参数）
    // 相当于: SELECT COUNT(*) AS count FROM intent_examples
    // ::bigint 是 PostgreSQL 类型转换，确保返回的是 bigint 类型
    const count = await this.prismaService.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count FROM intent_examples
    `;

    // count[0].count 是查询结果，比如 [{ count: 61 }]
    // 如果已有数据，跳过 seeding（幂等）
    if (Number(count[0].count) > 0) {
      logger.log(`IntentExamples already seeded: ${count[0].count} rows`);
      return;
    }

    logger.log(
      `Seeding intent_examples with ${INTENT_EXAMPLE_GROUPS.length} domains...`,
    );

    // ─── 第二步：遍历 8 个 domain × 61 个句子，生成向量并插入数据库 ───
    // INTENT_EXAMPLE_GROUPS 结构：
    // [
    //   { name: 'order',    examples: ['我要查订单', '订单号是多少', ...] },
    //   { name: 'wallet',   examples: ['提现', '余额', ...] },
    //   { name: 'product',  examples: ['搜索商品', '推荐', ...] },
    //   ... 共 8 个 domain，总共 61 个句子
    // ]
    for (const group of INTENT_EXAMPLE_GROUPS) {
      // ─── Dynamic Intent-Tool Alignment：跳过无工具注册的域 ───
      // 如果某个域（如 wallet）的 requiredTags 对应的工具尚未注册，
      // 则该域的例句不会被写入数据库 → 用户不会匹配到该域 → 自然降级到 LLM fallback
      // 这防止了"路由到 Agent 但 Agent 无工具可用"的问题
      if (group.requiredTags && this.toolRegistry) {
        const hasAnyTool = group.requiredTags.some(
          (tag) => this.toolRegistry!.getToolsByTag(tag).length > 0,
        );
        if (!hasAnyTool) {
          logger.warn(
            `Skipping "${group.name}": no tools registered for [${group.requiredTags.join(', ')}]`,
          );
          // 跳过整个域的所有例句（不生成 embedding、不写入数据库）
          // 这样 pgvector 查询时，该域的句子不存在，不会匹配到它
          break; // 跳出 for-of-examples 循环，继续下一个域
        }
      }

      for (const example of group.examples) {
        // ─── 调用 AI 服务，把文字转成 2048 维向量 ───
        // generateEmbedding 会调用 DeepSeek API:
        //   POST https://api.deepseek.com/v1/embeddings
        //   body: { model: 'deepseek-embedding', input: '我要查订单' }
        //   返回: [0.0123, -0.0456, 0.0789, ...] (2048 个浮点数)
        const vec = await this.aiService.generateEmbedding(example);
        if (!vec || vec.length === 0) {
          logger.warn(
            `Failed to embed "${example.slice(0, 40)}..." for "${group.name}"`,
          );
          continue;
        }

        // ─── 把向量数组转成 PostgreSQL vector 格式 ───
        // 比如: [0.0123, -0.0456, 0.0789] → "[0.0123,-0.0456,0.0789]"
        // PostgreSQL 的 vector 类型接受这种格式的字符串
        const vectorStr = `[${vec.join(',')}]`;

        // ─── 插入数据库 ───
        // $executeRawUnsafe: 执行原生 SQL（不返回数据，只执行）
        // $1, $2, $3, $4 是参数占位符，防止 SQL 注入
        // ::vector 是 pgvector 的类型转换，把字符串转成 vector 类型
        await this.prismaService.$executeRawUnsafe(
          `INSERT INTO intent_examples (id, domain, sentence, embedding)
           VALUES ($1, $2, $3, $4::vector)`,
          this.generateId(), // $1: 随机 ID（如 "l3x7m2a9b5"）
          group.name, // $2: domain 名（如 'order'）
          example, // $3: 原始句子（如 '我要查订单'）
          vectorStr, // $4: 向量字符串（如 '[0.0123,-0.0456,...]'）
        );
      }
      logger.log(`  ✓ ${group.name}: ${group.examples.length} examples seeded`);
    }

    logger.log('IntentExamples seeding complete');
  }

  /**
   * 分类用户输入
   *
   * ── 流程 ──
   * 1. 确保数据库已有示例向量（ensureSeeded）
   * 2. 把用户输入转成向量（generateEmbedding）
   * 3. 用 SQL 查询找最匹配的 domain
   * 4. 如果最高分 < 0.5，返回 llm_fallback（让上层用 LLM 处理）
   *
   * @param input 用户输入的文字（如 "我要查订单"）
   * @returns 分类结果
   */
  async classify(input: string): Promise<ClassificationResult> {
    // ─── 第一步：确保数据库已有示例数据（幂等，第一次才真正执行） ───
    await this.ensureSeeded();

    // ─── 第二步：把用户输入的文字转成向量 ───
    // 现在使用 bge-m3 (Ollama) 生成 embedding
    // "那我要买Women Crossbody Bag Set，团购价格多少，加上优惠券，我还有多少钱"
    //   → [0.0123, -0.0456, 0.0789, ...] (1024 维)
    const inputVector = await this.aiService.generateEmbedding(input);

    // 如果 embedding 失败（网络问题、API key 失效等），降级到 LLM
    if (!inputVector || inputVector.length === 0) {
      logger.warn(`Failed to embed user input, using LLM fallback`);
      return {
        intent: 'general',
        labels: [{ label: 'general', score: 0.5 }],
        method: 'llm_fallback',
      };
    }

    // 同样转成字符串格式传给 SQL
    const vectorStr = `[${inputVector.join(',')}]`;

    // ─── 第三步：SQL 查询 — pgvector 多标签余弦相似度 ───
    //
    // 单标签 → 多标签优化：
    //   之前用 LIMIT 1 只返回最匹配的一个域。
    //   现在用 LIMIT 5 + 域去重，返回所有高于阈值的域。
    //
    // ════════════════════════════════════════════════════════════════
    // 【运行示例 — "那我要买Women Crossbody Bag Set，团购价格多少，加上优惠券，我还有多少钱"]
    // ════════════════════════════════════════════════════════════════
    //
    // 第1步: ensureSeeded() → 检查数据库 → 已有 61 条数据 → 跳过
    //
    // 第2步: generateEmbedding("那我要买...") → bge-m3 / DeepSeek
    //   → [0.0123, -0.0456, 0.0789, ...] (1024 维向量)
    //
    // 第3步: SQL 查询 (pgvector <=> 余弦距离):
    //   SELECT domain, 1 - (embedding <=> $1::vector) AS similarity
    //   FROM intent_examples
    //   ORDER BY similarity DESC
    //   LIMIT 5
    //
    //   返回 TOP-5 原始行:
    //   1. product — similarity=0.8565  ← "团购价格" 匹配了 group buy 例句!
    //   2. product — similarity=0.6168
    //   3. coupon — similarity=0.6005    ← "优惠券" 匹配了 coupon 例句
    //   4. wallet — similarity=0.5885    ← "我钱包还有多少钱" 匹配了 wallet 例句
    //   5. product — similarity=0.5865
    //
    // 第4步: 域去重 (domainMap) — 同域取最高分:
    //   product → max(0.8565, 0.6168, 0.5865) = 0.8565
    //   coupon  → 0.6005
    //   wallet  → 0.5885
    //
    // 第5步: 阈值过滤 (>= 0.5) + 分数取 2 位小数:
    //   [{label:'product', score:0.86}, {label:'coupon', score:0.60}, {label:'wallet', score:0.59}]
    //
    // 第6步: 返回 ClassificationResult:
    //   {
    //     intent: 'product',          ← 最高分域
    //     labels: [{product:0.86}, {coupon:0.60}, {wallet:0.59}],
    //     method: 'embedding',
    //     rawTop5: [{domain:'product',similarity:0.86}, {domain:'product',similarity:0.62}, ...]
    //   }
    //
    // orchestrator 收到 labels 后按依赖规则重排执行顺序:
    //   executionOrder = [product, coupon, wallet]
    // ════════════════════════════════════════════════════════════════
    //
    // 对比旧版单标签示例（仅产品域）:
    //   之前 LIMIT 1 → 只返回 product:0.86
    //   现在 LIMIT 5 → 返回 coupon:0.60 + wallet:0.59
    //   → 用户一次提问就能同时获取商品价、优惠券、余额
    const rows = await this.prismaService.$queryRawUnsafe<
      {
        domain: string;
        similarity: number;
      }[]
    >(
      `SELECT domain, 1 - (embedding <=> $1::vector) AS similarity
       FROM intent_examples
       ORDER BY similarity DESC
         LIMIT 5`,
      vectorStr,
    );

    // ─── 第四步：处理多标签结果 ───

    // 如果表里一条数据都没有（正常情况下不会发生，因为 ensureSeeded 保证了有数据）
    if (rows.length === 0) {
      logger.warn('No intent_examples found, using LLM fallback');
      return {
        intent: 'general',
        labels: [{ label: 'general', score: 0.5 }],
        method: 'llm_fallback',
      };
    }

    // 🔍 日志：原始 SQL 返回的 TOP-5 结果（含同域不同例句）
    logger.log(
      `[IntentClassifier] pgvector raw TOP-5:\n` +
        rows
          .map(
            (r, i) =>
              `  ${i + 1}. ${r.domain} — similarity=${r.similarity.toFixed(4)}`,
          )
          .join('\n'),
    );

    // 按域去重 + 阈值过滤：同一个域可能有多个例句匹配，取最高分
    // 例如 coupon 出现两次（0.87, 0.69）→ 只保留 0.87
    const domainMap = new Map<string, number>();
    for (const row of rows) {
      logger.log(
        `[IntentClassifier] row: domain="${row.domain}", similarity=${row.similarity.toFixed(4)}, threshold=${this.LOW_CONFIDENCE_THRESHOLD}, passes=${row.similarity >= this.LOW_CONFIDENCE_THRESHOLD}`,
      );
      if (row.similarity >= this.LOW_CONFIDENCE_THRESHOLD) {
        const existing = domainMap.get(row.domain) ?? 0;
        if (row.similarity > existing) {
          domainMap.set(row.domain, row.similarity);
        }
      }
    }

    // 按分数降序排列
    const labels = Array.from(domainMap.entries())
      .map(([label, rawScore]) => ({
        label,
        score: Math.round(rawScore * 100) / 100,
      }))
      .sort((a, b) => b.score - a.score);

    // 如果没有域通过阈值 → LLM fallback
    if (labels.length === 0) {
      logger.log(
        `[IntentClassifier] all domains below threshold (${rows[0].similarity.toFixed(2)} < ${this.LOW_CONFIDENCE_THRESHOLD}), using LLM fallback`,
      );
      return {
        intent: 'general',
        labels: [{ label: 'general', score: 0.5 }],
        method: 'llm_fallback',
        rawTop5: rows.map((r) => ({
          domain: r.domain,
          similarity: Math.round(r.similarity * 100) / 100,
        })),
      };
    }

    // 主意图 = 最高分域
    const primaryLabel = labels[0];
    logger.log(
      `[IntentClassifier] deduped labels: ${labels.map((l) => `${l.label}:${l.score.toFixed(2)}`).join(', ')}`,
    );
    logger.log(
      `[IntentClassifier] primary: ${primaryLabel.label} (${primaryLabel.score.toFixed(2)})` +
        (labels.length > 1
          ? `, multi-intent: ${labels.map((l) => `${l.label}:${l.score.toFixed(2)}`).join(', ')}`
          : ''),
    );

    return {
      intent: primaryLabel.label,
      labels, // 所有高于阈值的域 → orchestrator 逐个执行
      method: 'embedding',
      rawTop5: rows.map((r) => ({
        domain: r.domain,
        similarity: Math.round(r.similarity * 100) / 100,
      })),
    };
  }

  /** 生成简短唯一 ID（用于 INSERT 时的主键） */
  private generateId(): string {
    // Date.now().toString(36): 当前时间戳转 36 进制（如 "l3x7m2"）
    // Math.random().toString(36).slice(2, 8): 随机数转 36 进制取 6 位（如 "a9b5c8"）
    // 组合: "l3x7m2a9b5c8" — 基本不会重复
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
}
