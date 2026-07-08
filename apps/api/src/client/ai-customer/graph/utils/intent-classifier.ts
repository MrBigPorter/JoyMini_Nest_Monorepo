/**
 * IntentClassifier — 基于 pgvector 的意图分类器
 *
 * ═══════════════════════════════════════════════════════════════
 * 🏪 餐厅类比：IntentClassifier = 前台「领位员」
 * ═══════════════════════════════════════════════════════════════
 *
 * 整个 AI 客服系统就像一家餐厅：
 * ┌─────────────────────────────────────────────────────────┐
 * │  顾客走进餐厅 ...                                       │
 * │                                                        │
 * │  1. IntentClassifier (领位员)                            │
 * │     "您好，几位？想吃点什么？"                            │
 * │     → 判断顾客意图：订餐(Order) / 咨询(RAG) / 优惠券... │
 * │                                                        │
 * │  2. IntentRouter (引座员)                                │
 * │     "订餐请走这边，咨询请到前台"                          │
 * │     → 根据领位员的判断，把顾客带到对应区域                │
 * │                                                        │
 * │  3. Agent (对应区域的服务员)                              │
 * │     OrderAgent: "欢迎点餐，这是菜单"                     │
 * │     RAGAgent: "有什么可以帮您？"                         │
 * │     CouponAgent: "这是今天的优惠活动"                    │
 * │                                                        │
 * │  4. Orchestrator (大堂经理)                              │
 * │     如果顾客有多个需求，协调多个服务员同时服务             │
 * └─────────────────────────────────────────────────────────┘
 *
 * 【领位员怎么判断？】
 * 领位员手里有一本「标准问答手册」（intent_examples 表），
 * 里面记录了各种场景的标准问法：
 *   - order: "我要退货"、"订单状态" ...
 *   - rag: "退款政策是什么？"、"运费多少？" ...
 *   - coupon: "有优惠券吗？" ...
 *
 * 当顾客说话时，领位员：
 * 1. 把顾客的话转成「语义指纹」（embedding 向量）
 * 2. 拿这个指纹去手册里比对（pgvector 余弦相似度）
 * 3. 找到最匹配的场景（相似度最高的 domain）
 * 4. 如果匹配度 > 0.5，直接领到对应区域
 * 5. 如果匹配度 < 0.5，交给经理（LLM）处理
 *
 * 【为什么 "退款政策" 会匹配到 order？】
 * 因为 order 手册里也写了 "What is the return policy?"，
 * 和 rag 手册里的句子一模一样。
 * 领位员看到两个手册都有这句话，就不知道往哪领了。
 * 解决方案：把政策类问题从 order 手册移到 rag 手册。
 *
 * ═══════════════════════════════════════════════════════════════
 *
 * -- 架构 --
 * intent_examples 表是唯一数据源（Single Source of Truth）。
 * 数据通过管理后台 PUT /admin/intent-examples/:domain 接口写入，
 * 保存时立即生成向量并写入数据库。
 *
 * -- 流程 --
 * 1. classify() 把用户输入转成向量，用 pgvector <=> 找最匹配的 domain
 *    如果匹配度 > 0.5 直接返回 domain，否则降级到 LLM
 * 2. 无论何种结果，fire-and-forget 日志记录
 *
 * -- 管理后台修改流程 --
 * 管理后台 PUT /admin/intent-examples/:domain 保存例句时：
 * 1. 保存到 intent_example_configs 表（记录元数据：updatedAt, updatedBy）
 * 2. 立即生成 embeddings 并写入 intent_examples 表（覆盖该 domain 的旧向量）
 * 3. classify() 下次调用时直接读取最新数据，无需任何合并逻辑
 */
import { AiService } from '@api/common/ai/ai.service';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { Logger } from '@nestjs/common';
import { deduplicateLabels } from '@api/client/ai-customer/graph/agents/prompts/intent-label-categories';

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

/**
 * IntentClassifier — 前台领位员
 *
 * 🏪 餐厅类比：
 * ────────────────────────────────────────────────────────────
 * 这个类就是餐厅门口的领位员。
 * 顾客一进门，领位员就要判断：
 *   - 这位顾客是来吃饭的（order）？
 *   - 还是来咨询的（rag）？
 *   - 还是来取优惠券的（coupon）？
 *
 * 判断依据是「标准问答手册」（intent_examples 表），
 * 里面记录了各种场景的典型问法。
 *
 * 【核心方法】
 * classify(input) = 领位员判断顾客意图
 *   1. 把顾客的话转成语义指纹（embedding）
 *   2. 拿指纹去手册里比对（pgvector 查询）
 *   3. 返回最匹配的场景（domain）
 *
 * 【为什么需要 OllamaProvider.generateEmbedding？】
 * 领位员需要把顾客的话转成「语义指纹」，
 * 这个指纹由 OllamaProvider（食材化验员）生成。
 * 详见 OllamaProvider 的注释。
 */
export class IntentClassifier {
  /** 低置信度阈值：低于此值时使用 LLM fallback */
  private readonly LOW_CONFIDENCE_THRESHOLD = 0.5;

  constructor(
    private readonly aiService: AiService, // 用于 generateEmbedding() -- 把文字转成向量
    private readonly prismaService: PrismaService, // 用于 pgvector SQL 查询
  ) {}

  /**
   * 分类用户输入 — 领位员判断顾客意图
   *
   * 🏪 餐厅类比：
   * ────────────────────────────────────────────────────────────
   * 顾客说了一句话，领位员要做三件事：
   *
   * 第1步：生成语义指纹
   *   把顾客的话（"我要退货"）送进化验室（OllamaProvider），
   *   生成一串数字指纹（embedding 向量）。
   *   如果化验室出故障（网络问题），直接找经理（LLM fallback）。
   *
   * 第2步：比对标准手册
   *   拿这个指纹去数据库里比对（pgvector 余弦相似度），
   *   找出 TOP-5 最匹配的标准问法。
   *   比如：
   *     1. order -- 相似度 0.92（"我要退货"）
   *     2. order -- 相似度 0.85（"退货流程"）
   *     3. rag  -- 相似度 0.76（"退款政策"）
   *     4. rag  -- 相似度 0.76（"退货政策是什么"）
   *     5. product -- 相似度 0.45（"这个商品怎么样"）
   *
   * 第3步：去重 + 阈值过滤
   *   同一个 domain 可能有多个例句匹配，取最高分。
   *   去掉低于 0.5 的（太低的不确定）。
   *   如果所有 domain 都低于 0.5，找经理（LLM fallback）。
   *
   * 【为什么 "退款政策" 会同时匹配 order 和 rag？】
   * 因为 order 手册和 rag 手册里都有 "What is the return policy?"
   * 这句话。两个手册都有，领位员就困惑了。
   * 解决方案：把政策类问题从 order 手册移到 rag 手册，
   * 让 order 只保留订单操作类问题。
   *
   * @param input 用户输入的文字（顾客说的话）
   * @returns 分类结果（领位员的判断）
   */
  async classify(input: string): Promise<ClassificationResult> {
    const startTime = Date.now();

    // -- 第一步：把用户输入的文字转成向量 --
    // 🏪 类比：把顾客的话送进化验室，生成语义指纹
    // 现在使用 bge-m3 (Ollama) 生成 embedding
    const inputVector = await this.aiService.generateEmbedding(input);

    // 如果 embedding 失败（网络问题、API key 失效等），降级到 LLM
    // 🏪 类比：化验室出故障了，直接找经理处理
    if (!inputVector || inputVector.length === 0) {
      logger.warn(`Failed to embed user input, using LLM fallback`);
      const result: ClassificationResult = {
        intent: 'general',
        labels: [{ label: 'general', score: 0.5 }],
        method: 'llm_fallback',
      };
      // Fire-and-forget: 不阻塞主流程
      this.logClassification(input, result, Date.now() - startTime);
      return result;
    }

    // 同样转成字符串格式传给 SQL
    const vectorStr = `[${inputVector.join(',')}]`;

    // -- 第三步：SQL 查询 -- pgvector 多标签余弦相似度 --
    // 🏪 类比：拿语义指纹去标准手册里比对，找 TOP-5 最匹配的
    //
    // 单标签 -> 多标签优化：
    //   之前用 LIMIT 1 只返回最匹配的一个域。
    //   现在用 LIMIT 5 + 域去重，返回所有高于阈值的域。
    //
    // 技术细节：
    //   pgvector 的 <=> 是余弦距离（0=完全相同，1=完全不同）
    //   1 - (embedding <=> $1::vector) 转成余弦相似度（1=完全相同，0=完全不同）
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

    // -- 第四步：处理多标签结果 --

    // 如果表里一条数据都没有（正常情况下不会发生，因为管理后台写入保证了有数据）
    // 🏪 类比：标准手册是空的，没法判断，找经理
    if (rows.length === 0) {
      logger.warn('No intent_examples found, using LLM fallback');
      const result: ClassificationResult = {
        intent: 'general',
        labels: [{ label: 'general', score: 0.5 }],
        method: 'llm_fallback',
      };
      // Fire-and-forget: 不阻塞主流程
      this.logClassification(input, result, Date.now() - startTime);
      return result;
    }

    // 日志：原始 SQL 返回的 TOP-5 结果（含同域不同例句）
    // 🏪 类比：领位员看一眼手册上的 TOP-5 匹配结果
    logger.log(
      `[IntentClassifier] pgvector raw TOP-5:\n` +
        rows
          .map(
            (r, i) =>
              `  ${i + 1}. ${r.domain} -- similarity=${r.similarity.toFixed(4)}`,
          )
          .join('\n'),
    );

    // 按域去重 + 阈值过滤：同一个域可能有多个例句匹配，取最高分
    // 🏪 类比：同一个场景有多条标准问法，取最匹配的那条
    // 比如 order 有 "我要退货"(0.92) 和 "退货流程"(0.85)，取 0.92
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

    // ── 分数降序排列 + 业务标签去重 ──
    // 先按相似度降序排列，再应用 dedup 规则（业务优先，移除 general）
    // 🏪 类比：把匹配的场景按匹配度从高到低排好
    // 如果有 general（通用）和其他业务场景同时匹配，
    // 业务场景优先（比如 order 优先于 general）
    const sortedLabels = Array.from(domainMap.entries())
      .map(([label, rawScore]) => ({
        label,
        score: Math.round(rawScore * 100) / 100,
      }))
      .sort((a, b) => b.score - a.score);
    const labels = deduplicateLabels(sortedLabels);

    // 如果没有域通过阈值 -> LLM fallback
    // 🏪 类比：所有场景的匹配度都太低（< 0.5），
    // 领位员拿不准，找经理（LLM）来处理
    if (labels.length === 0) {
      logger.log(
        `[IntentClassifier] all domains below threshold (${rows[0].similarity.toFixed(2)} < ${this.LOW_CONFIDENCE_THRESHOLD}), using LLM fallback`,
      );
      const result: ClassificationResult = {
        intent: 'general',
        labels: [{ label: 'general', score: 0.5 }],
        method: 'llm_fallback',
        rawTop5: rows.map((r) => ({
          domain: r.domain,
          similarity: Math.round(r.similarity * 100) / 100,
        })),
      };
      // Fire-and-forget: 不阻塞主流程
      this.logClassification(input, result, Date.now() - startTime);
      return result;
    }

    // 主意图 = 最高分域
    // 🏪 类比：领位员确定了，这位顾客是来 "order（订餐）" 的
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

    const result: ClassificationResult = {
      intent: primaryLabel.label,
      labels, // 所有高于阈值的域 -> orchestrator 逐个执行
      method: 'embedding',
      rawTop5: rows.map((r) => ({
        domain: r.domain,
        similarity: Math.round(r.similarity * 100) / 100,
      })),
    };

    // Fire-and-forget: 不阻塞主流程
    this.logClassification(input, result, Date.now() - startTime);
    return result;
  }

  /**
   * 异步记录分类日志（fire-and-forget）
   *
   * 🏪 餐厅类比：领位员在登记簿上记录今天的客人情况
   * ────────────────────────────────────────────────────────────
   * 每次有客人来，领位员都会在本子上记一笔：
   *   - 客人说了什么（userInput）
   *   - 领位员判断是什么场景（primaryIntent）
   *   - 判断用了多久（latencyMs）
   *   - 判断的把握有多大（confidence）
   *
   * 这个本子（intent_classification_logs 表）用于：
   *   - 监控面板：看看今天来了多少客人，都是什么类型的
   *   - 性能分析：领位员判断得快不快
   *   - 错误分析：有没有判断错的
   *
   * 设计原则：
   * - 不 await：领位员不能因为写本子而耽误接待下一位客人
   * - 内部 try/catch：即使本子坏了也不影响接待流程
   * - 自动处理 sessionId 缺省值
   *
   * @param input     用户原始输入
   * @param result    分类结果
   * @param latencyMs 分类耗时（毫秒）
   * @param sessionId 可选的会话 ID（缺省时记录为 'unknown'）
   */
  private async logClassification(
    input: string,
    result: ClassificationResult,
    latencyMs: number,
    sessionId?: string,
  ): Promise<void> {
    try {
      await this.prismaService.$executeRawUnsafe(
        `INSERT INTO intent_classification_logs (id, "sessionId", "userInput", "primaryIntent", "allLabels", method, confidence, "latencyMs", "rawTop5")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        this.generateId(),
        sessionId ?? 'unknown',
        input,
        result.intent,
        JSON.stringify(result.labels),
        result.method,
        result.labels[0]?.score ?? null,
        latencyMs,
        result.rawTop5 ? JSON.stringify(result.rawTop5) : null,
      );
    } catch (err) {
      logger.warn(`Failed to log classification: ${err}`);
    }
  }

  /** 生成简短唯一 ID（用于 INSERT 时的主键） */
  private generateId(): string {
    // Date.now().toString(36): 当前时间戳转 36 进制
    // Math.random().toString(36).slice(2, 8): 随机数转 36 进制取 6 位
    // 组合: "l3x7m2a9b5c8" -- 基本不会重复
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
}
