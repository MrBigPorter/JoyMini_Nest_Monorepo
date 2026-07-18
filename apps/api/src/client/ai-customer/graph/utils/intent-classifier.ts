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
import { MeilisearchService } from '@api/common/meilisearch/meilisearch.service';
import { Logger } from '@nestjs/common';
import { deduplicateLabels } from '@api/client/ai-customer/graph/agents/prompts/intent-label-categories';
import { createLLM, LlmProviderConfig } from '../llm-factory';

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

  /** BM25 和 pgvector 独立评分，不融合（不同域名的分数不可比） */

  constructor(
    private readonly aiService: AiService,
    private readonly prismaService: PrismaService,
    private readonly meilisearchService: MeilisearchService,
    private readonly llmConfig: LlmProviderConfig,
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

    // Normalize input for case-insensitive intent matching
    // bge-m3 embeddings are case-sensitive (e.g. "kyc" ≠ "KYC"),
    // but intent examples are stored in lowercase/mixed case.
    const normalizedInput = input.trim().toLowerCase();

    // ── Layer 1 & 2: BM25 + Embedding 并发 ──
    // BM25 关键词搜索和 embedding 生成互不依赖，并行执行以减少延迟
    const bm25Start = Date.now();
    let bm25DomainMap = new Map<string, number>();

    // 翻译非英文输入，供 BM25 关键词搜索

    const bm25Input = await this.translateToEnglish(normalizedInput);
    const [bm25Result, embeddingResult] = await Promise.allSettled([
      this.meilisearchService.searchIntentExamples(bm25Input, 10),
      this.aiService.generateEmbedding(normalizedInput, {
        task: 'retrieval.passage',
      }),
    ]);

    logger.debug(
      `[IntentClassifier] BM25 search took ${Date.now() - bm25Start}ms`,
    );

    // 处理 BM25 结果
    if (bm25Result.status === 'fulfilled') {
      for (const hit of bm25Result.value) {
        // Position-based score from searchIntentExamples: 0.5-1.0 range
        const normalizedScore = hit.score;
        const existing = bm25DomainMap.get(hit.domain) ?? 0;
        if (normalizedScore > existing) {
          bm25DomainMap.set(hit.domain, normalizedScore);
        }
      }
      logger.log(
        `[IntentClassifier] BM25 search took ${Date.now() - bm25Start}ms, ${bm25DomainMap.size} results` +
          (bm25DomainMap.size > 0
            ? `: ${JSON.stringify(Array.from(bm25DomainMap.entries()))}`
            : ''),
      );
    } else {
      logger.warn(
        `[IntentClassifier] Meilisearch query failed: ${bm25Result.reason}`,
      );
    }

    // 处理 embedding 结果
    if (embeddingResult.status === 'rejected') {
      logger.warn(
        `[IntentClassifier] Embedding failed: ${embeddingResult.reason}, using LLM fallback`,
      );
      const result: ClassificationResult = {
        intent: 'general',
        labels: [{ label: 'general', score: 0.5 }],
        method: 'llm_fallback',
      };
      this.logClassification(normalizedInput, result, Date.now() - startTime);
      return result;
    }

    const inputVector = embeddingResult.value;

    // 如果 embedding 返回空向量，降级到 LLM
    if (!inputVector || inputVector.length === 0) {
      logger.warn(
        `Failed to embed user input (empty vector), using LLM fallback`,
      );
      const result: ClassificationResult = {
        intent: 'general',
        labels: [{ label: 'general', score: 0.5 }],
        method: 'llm_fallback',
      };
      this.logClassification(normalizedInput, result, Date.now() - startTime);
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
        sentence: string;
      }[]
    >(
      `SELECT domain, sentence, 1 - (embedding <=> $1::vector) AS similarity
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
      this.logClassification(normalizedInput, result, Date.now() - startTime);
      return result;
    }

    // 日志：原始 SQL 返回的 TOP-5 结果（含同域不同例句）
    // 🏪 类比：领位员看一眼手册上的 TOP-5 匹配结果
    logger.log(
      `[IntentClassifier] pgvector raw TOP-5:\n` +
        rows
          .map(
            (r, i) =>
              `  ${i + 1}. ${r.domain} (${r.similarity.toFixed(4)}) "${(r as any).sentence?.slice(0, 80)}"`,
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
    // ── human_support BM25 惩罚 ──
    // pgvector 命中了 human_support,如果 BM25 没命中 human_support 关键词，说明用户大概率没说要转人工，是语义误匹配
    // 防止中文查询（如"优惠"）在翻译失败时误入 human_support
    if (domainMap.has('human_support') && !bm25DomainMap.has('human_support')) {
      const originalScore = domainMap.get('human_support') ?? 0;
      // 0.7 惩罚系数，保留 4 位小数
      const penalized = Math.round(originalScore * 0.7 * 10000) / 10000;
      domainMap.set('human_support', penalized);
      logger.log(
        `[IntentClassifier] human_support penalized: original=${originalScore.toFixed(4)}, penalized=${penalized.toFixed(4)} (BM25 missed)`,
      );
    }

    // ── BM25 + pgvector 独立加入 ──
    // BM25 和 pgvector 各自独立，不融合。
    // vector 命中的 domain 保留语义分数，BM25 独有的 domain 新增加入。
    // 同一个 domain 两边都命中 → 保留 vector 分数（语义比关键词更可靠）。
    if (bm25DomainMap.size > 0) {
      for (const [domain, bm25Score] of bm25DomainMap) {
        if (domainMap.has(domain)) {
          // 两边都有 → 保留 vector 分数
          const vectorScore = domainMap.get(domain)!;
          logger.log(
            `[IntentClassifier] both sources matched ${domain}: ` +
              `vector=${vectorScore.toFixed(4)} (kept), bm25=${bm25Score.toFixed(4)} (independent source)`,
          );
        } else if (bm25Score >= this.LOW_CONFIDENCE_THRESHOLD) {
          // BM25 独有 → 直接加入（关键词强命中，pgvector 漏检）
          const score = Math.round(bm25Score * 10000) / 10000;
          domainMap.set(domain, score);
          logger.log(
            `[IntentClassifier] bm25-only ${domain}: bm25=${bm25Score.toFixed(4)} → ${score.toFixed(4)} (vector missed)`,
          );
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
      this.logClassification(normalizedInput, result, Date.now() - startTime);
      return result;
    }

    // ── 差距阈值保护 ──────────────────────────────────────────────
    // 当 top1 和 top2 的相似度差距极小（< 0.02）时，说明 pgvector
    // 无法可靠区分这两个意图。此时如果 top1 是 rag/general（通用兜底
    // 意图），而 top2 是具体业务意图（kyc/order/wallet），优先选择
    // 具体业务意图。
    //
    // 为什么需要这个规则？
    //   rag 包含 ~140 条示例，覆盖了几乎所有领域的 FAQ 问题（包括
    //   KYC 流程、退款政策等）。它的聚类中心非常"宽"，容易和具体
    //   业务意图的边界重叠。当用户说"查看kyc"时，embedding 同时匹配
    //   了 rag（因为 rag 有 KYC FAQ 示例）和 kyc（因为 kyc 有状态
    //   查询示例），分数仅差 0.0007。此时选择更具体的 kyc 更合理。
    //
    //   general 同理：它是 LLM fallback 的兜底标签，不应该在
    //   有具体业务意图匹配时胜出。
    const GAP_THRESHOLD = 0.02;
    const CATCH_ALL_INTENTS = new Set(['rag', 'general']);
    let primaryLabel = labels[0];
    if (labels.length >= 2) {
      const gap = labels[0].score - labels[1].score;
      if (
        gap >= 0 &&
        gap < GAP_THRESHOLD &&
        CATCH_ALL_INTENTS.has(labels[0].label)
      ) {
        primaryLabel = labels[1];
        logger.log(
          `[IntentClassifier] tiebreaker: ${labels[0].label}=${labels[0].score} vs ${labels[1].label}=${labels[1].score} (gap=${gap.toFixed(4)} < ${GAP_THRESHOLD}), chose: ${primaryLabel.label}`,
        );
      }
    }

    // 主意图 = 最高分域（或差距阈值修正后的意图）
    // 🏪 类比：领位员确定了，这位顾客是来 "order（订餐）" 的
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
    this.logClassification(normalizedInput, result, Date.now() - startTime);
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

  /**
   * 检测文本是否需要翻译（含中日韩文字）
   */
  private needsTranslation(text: string): boolean {
    return /[\u4e00-\u9fff\u3040-\u309f\uac00-\ud7af]/.test(text);
  }

  /**
   * 翻译非英文文本为英文（极简 prompt，只返回翻译结果）
   * 翻译失败时回退到原文
   */
  private async translateToEnglish(text: string): Promise<string> {
    if (!this.needsTranslation(text)) {
      return text;
    }
    try {
      const model = createLLM(this.llmConfig, {
        temperature: 0,
      });
      const result = await model.invoke(
        `Translate the following text to English. Only return the translated text, no explanations or extra text.\n\n"${text}"`,
      );
      const translated =
        typeof result.content === 'string' ? result.content.trim() : '';
      return translated || text;
    } catch (err) {
      logger.warn(`Translation failed: ${err}`);
      return text;
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
