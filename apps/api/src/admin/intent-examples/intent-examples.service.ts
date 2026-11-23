import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { AiService } from '@api/common/ai/ai.service';
import { ConfigService } from '@nestjs/config';
import { MeilisearchService } from '@api/common/meilisearch/meilisearch.service';
import { IntentClassifier } from '@api/client/ai-customer/graph/utils/intent-classifier';
import { LlmProviderConfig } from '@api/client/ai-customer/graph/llm-factory';
import { INTENT_EXAMPLE_GROUPS } from '@api/client/ai-customer/graph/agents/prompts/intent-examples';
import { getIntentDomains } from '@api/client/ai-customer/graph/config/intent-domain-registry';
import { md5 } from '@api/common/crypto.util';
import { EMBEDDING_QUEUE } from '@api/common/ai/queues/embedding/embedding-queue.constants';
import type { EmbeddingJobData } from '@api/common/ai/queues/embedding/embedding.processor';

type EmbeddingJobMeta = Pick<
  EmbeddingJobData,
  'source' | 'candidateId' | 'locale' | 'normalizedHash'
>;
import {
  IntentExampleGroupResponseDto,
  IntentExampleSectionDto,
  UpdateIntentExamplesResponseDto,
  TestClassificationResponseDto,
} from './dto/intent-examples-response.dto';

@Injectable()
export class IntentExamplesService {
  private readonly logger = new Logger(IntentExamplesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    private readonly meilisearchService: MeilisearchService,
    private readonly configService: ConfigService,
    @InjectQueue(EMBEDDING_QUEUE)
    private readonly embeddingQueue: Queue<EmbeddingJobData>,
  ) {}

  /**
   * Get all domains' example sentences.
   *
   * DB-first: reads distinct domains from intent_examples table,
   * then merges with INTENT_EXAMPLE_GROUPS for metadata.
   * Admin-created domains (not in INTENT_EXAMPLE_GROUPS) appear with isAdminCreated=true.
   */
  async getAll(): Promise<IntentExampleGroupResponseDto[]> {
    // 1. Read ALL distinct domains from intent_examples (the source of truth)
    const dbDomains = await this.prisma.$queryRawUnsafe<{ domain: string }[]>(
      `SELECT DISTINCT domain FROM intent_examples ORDER BY domain`,
    );

    // 2. Read config metadata (sections, updatedAt, updatedBy)
    const configs = await this.prisma.intentExampleConfig.findMany();
    const configMap = new Map(configs.map((c) => [c.domain, c]));

    // 3. Build response: DB domains first, then code-defined domains not yet in DB
    const seen = new Set<string>();
    const result: IntentExampleGroupResponseDto[] = [];
    // Build a lookup map for INTENT_EXAMPLE_GROUPS (seed data)
    const examplesMap = new Map(INTENT_EXAMPLE_GROUPS.map((g) => [g.name, g]));

    for (const { domain } of dbDomains) {
      seen.add(domain);
      const config = configMap.get(domain);
      const codeGroup = examplesMap.get(domain);
      const parsed = config
        ? this.parseConfigSentences(config.sentences)
        : null;

      result.push({
        name: domain,
        examples: parsed?.flat ?? [],
        sections: parsed?.sections,
        requiredTags: codeGroup?.requiredTags,
        hasAdminOverride: !!config,
        updatedAt: config?.updatedAt?.toISOString() ?? null,
        isAdminCreated: !codeGroup,
      });
    }

    // Add registry domains not yet present in intent_examples.
    // 注册表是唯一来源：停用的域不会出现，也不会再靠 TS 常量补位。
    const registry = await getIntentDomains(this.prisma);
    for (const domain of registry) {
      if (domain.type === 'transfer') continue;
      if (!seen.has(domain.label)) {
        const codeGroup = examplesMap.get(domain.label);
        result.push({
          name: domain.label,
          examples: codeGroup?.examples ?? [],
          requiredTags: codeGroup?.requiredTags,
          hasAdminOverride: false,
          updatedAt: null,
          isAdminCreated: !codeGroup,
        });
      }
    }

    return result;
  }

  /**
   * Get a single domain's example sentences.
   *
   * Reads from intent_examples table (the single source of truth).
   * Falls back to TS defaults if no data in intent_examples.
   */
  async getByDomain(domain: string): Promise<IntentExampleGroupResponseDto> {
    // 注册表口径与 createDomain 保持一致：未注册/已停用的域都不可读写。
    const domains = await getIntentDomains(this.prisma);
    const validDomain = domains.find((d) => d.label === domain);
    if (!validDomain) {
      throw new NotFoundException(`Domain "${domain}" not found`);
    }

    const group = INTENT_EXAMPLE_GROUPS.find((g) => g.name === domain);

    // Read actual sentences from intent_examples
    const dbRows = await this.prisma.$queryRawUnsafe<{ sentence: string }[]>(
      `SELECT sentence FROM intent_examples WHERE domain = $1 ORDER BY sentence`,
      domain,
    );

    const config = await this.prisma.intentExampleConfig.findUnique({
      where: { domain },
    });

    const parsed = config ? this.parseConfigSentences(config.sentences) : null;

    return {
      name: domain,
      examples:
        dbRows.length > 0
          ? dbRows.map((r) => r.sentence)
          : (group?.examples ?? []),
      sections: parsed?.sections,
      requiredTags: group?.requiredTags,
      hasAdminOverride: !!config,
      updatedAt: config?.updatedAt?.toISOString() ?? null,
      isAdminCreated: !group,
    };
  }

  /**
   * Create a new intent domain with example sentences.
   *
   * 1. Check domain doesn't already exist
   * 2. Save config to intent_example_configs (with section structure if detected)
   * 3. Submit embedding jobs to BullMQ queue (async, non-blocking)
   */
  async createDomain(
    domain: string,
    sentences: string[],
    userId?: string,
  ): Promise<UpdateIntentExamplesResponseDto> {
    // 0. 域必须先注册（intent_domains）。新增业务域仍需要 Agent/代码，
    //    这里只允许给已存在的域补示例，避免后台造出分类器不认识的标签。
    const domains = await getIntentDomains(this.prisma);
    if (!domains.some((d) => d.label === domain)) {
      throw new BadRequestException(
        `Intent domain "${domain}" is not registered. Register it in intent_domains first.`,
      );
    }

    // 1. Check domain doesn't already exist in intent_examples
    const existing = await this.prisma.$queryRawUnsafe<{ cnt: number }[]>(
      `SELECT COUNT(*) as cnt FROM intent_examples WHERE domain = $1`,
      domain,
    );

    if (existing[0].cnt > 0) {
      throw new ConflictException(
        `Domain "${domain}" already exists in intent_examples`,
      );
    }

    // 2. Parse into sections (detect coupon.ts format)
    const sections = this.parseIntoSections(sentences);
    const flatSentences = sections.flatMap((s) => s.sentences);
    const newHash = md5(JSON.stringify(flatSentences));

    // Save config with structured sections
    await this.prisma.intentExampleConfig.create({
      data: {
        domain,
        sentences: JSON.stringify({ flat: flatSentences, sections }),
        configHash: newHash,
        updatedBy: userId,
      },
    });

    // 3. Submit embedding jobs to BullMQ queue (async, non-blocking)
    // 🏪 类比：服务员把化验单贴在窗口上，不用等结果出来
    const jobCount = await this.submitEmbeddingJobs(
      domain,
      flatSentences,
      newHash,
    );

    this.logger.log(
      `Created domain "${domain}": ${jobCount}/${flatSentences.length} embedding jobs submitted to queue`,
    );

    return { domain, count: jobCount };
  }

  /**
   * Update a domain's example sentences.
   *
   * Supports two modes:
   * - 'replace' (default): delete old vectors, insert new
   * - 'append': keep existing vectors, insert only new sentences (deduplicate by text)
   */
  async updateDomain(
    domain: string,
    sentences: string[],
    mode: 'append' | 'replace' = 'replace',
    userId?: string,
  ): Promise<UpdateIntentExamplesResponseDto> {
    // 注册表是唯一校验口径：未注册/停用的域不能更新示例。
    const domains = await getIntentDomains(this.prisma);
    if (!domains.some((d) => d.label === domain)) {
      throw new NotFoundException(`Domain "${domain}" not found`);
    }

    if (mode === 'append') {
      return this.appendToDomain(domain, sentences, userId);
    }

    // 'replace' mode: full replacement
    return this.replaceDomain(domain, sentences, userId);
  }

  /**
   * 候选审核专用入口：同时写 config 层（管理端可见、reindexDomain 不丢）
   * 与运行层（分类器可见），并带上 KB_CANDIDATE 溯源。
   * 应用服务是唯一写入口，审核控制器不直接碰这两张表。
   */
  async appendCandidateExample(
    domain: string,
    text: string,
    candidate: { id: string; locale?: string; normalizedHash?: string },
    userId?: string,
  ): Promise<UpdateIntentExamplesResponseDto> {
    const domains = await getIntentDomains(this.prisma);
    if (!domains.some((d) => d.label === domain)) {
      throw new NotFoundException(`Domain "${domain}" not found`);
    }

    return this.appendToDomain(domain, [text], userId, {
      source: 'KB_CANDIDATE',
      candidateId: candidate.id,
      locale: candidate.locale,
      normalizedHash: candidate.normalizedHash,
    });
  }

  /**
   * Append new sentences to an existing domain (deduplicate by text).
   */
  private async appendToDomain(
    domain: string,
    newSentences: string[],
    userId?: string,
    meta?: EmbeddingJobMeta,
  ): Promise<UpdateIntentExamplesResponseDto> {
    // Read existing sentences from intent_examples
    const existing = await this.prisma.$queryRawUnsafe<{ sentence: string }[]>(
      `SELECT sentence FROM intent_examples WHERE domain = $1`,
      domain,
    );

    const existingSet = new Set(existing.map((r) => r.sentence));
    const trulyNew = newSentences.filter((s) => !existingSet.has(s));

    if (trulyNew.length === 0) {
      this.logger.log(
        `Append to "${domain}": 0 new sentences (all duplicates)`,
      );
      return { domain, count: 0 };
    }

    // Read existing config to update sections
    const config = await this.prisma.intentExampleConfig.findUnique({
      where: { domain },
    });

    // Parse new sentences into sections for config update
    const newSections = this.parseIntoSections(trulyNew);
    const newHash = md5(
      JSON.stringify([...existing.map((r) => r.sentence), ...trulyNew]),
    );

    // Update config: merge sections. 没有 admin override 时也要建一条，
    // 否则候选批准只写了运行表，管理端 / reindexDomain 看不到这条例句。
    if (config) {
      const parsed = this.parseConfigSentences(config.sentences);
      const mergedSections = this.mergeSections(
        parsed?.sections ?? [],
        newSections,
      );
      const allFlat = mergedSections.flatMap((s) => s.sentences);

      await this.prisma.intentExampleConfig.update({
        where: { domain },
        data: {
          sentences: JSON.stringify({
            flat: allFlat,
            sections: mergedSections,
          }),
          configHash: newHash,
          updatedBy: userId,
        },
      });
    } else {
      const allFlat = [...existing.map((r) => r.sentence), ...trulyNew];
      await this.prisma.intentExampleConfig.create({
        data: {
          domain,
          sentences: JSON.stringify({
            flat: allFlat,
            sections: this.parseIntoSections(allFlat),
          }),
          configHash: newHash,
          updatedBy: userId,
        },
      });
    }

    // Submit only new sentences to embedding queue
    const jobCount = await this.submitEmbeddingJobs(
      domain,
      trulyNew,
      newHash,
      meta,
    );

    // BM25 索引同样要更新：只写向量不写 Meili，新句子永远不会被
    // 关键词通道命中（append 曾经漏了这一步）。
    void this.meilisearchService.indexIntentExamples(domain, [
      ...existing.map((r) => r.sentence),
      ...trulyNew,
    ]);

    this.logger.log(
      `Appended to "${domain}": ${jobCount}/${trulyNew.length} embedding jobs submitted to queue`,
    );

    return { domain, count: jobCount };
  }

  /**
   * Replace all sentences for a domain (delete old, insert new).
   */
  private async replaceDomain(
    domain: string,
    sentences: string[],
    userId?: string,
  ): Promise<UpdateIntentExamplesResponseDto> {
    // Parse into sections
    const sections = this.parseIntoSections(sentences);
    const flatSentences = sections.flatMap((s) => s.sentences);
    const newHash = md5(JSON.stringify(flatSentences));

    // Save config with structured sections
    await this.prisma.intentExampleConfig.upsert({
      where: { domain },
      create: {
        domain,
        sentences: JSON.stringify({ flat: flatSentences, sections }),
        configHash: newHash,
        updatedBy: userId,
      },
      update: {
        sentences: JSON.stringify({ flat: flatSentences, sections }),
        configHash: newHash,
        updatedBy: userId,
      },
    });

    // Delete old vectors
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM intent_examples WHERE domain = $1`,
      domain,
    );

    // Submit all sentences to embedding queue
    const jobCount = await this.submitEmbeddingJobs(
      domain,
      flatSentences,
      newHash,
    );

    // Sync to Meilisearch for BM25 hybrid search (fire-and-forget)
    this.meilisearchService.indexIntentExamples(domain, flatSentences);

    this.logger.log(
      `Replaced domain "${domain}": ${jobCount}/${flatSentences.length} embedding jobs submitted to queue`,
    );

    return { domain, count: jobCount };
  }

  /**
   * Re-index (re-generate embeddings) for a domain.
   * Useful when embedding model changes or some vectors failed.
   */
  async reindexDomain(
    domain: string,
  ): Promise<UpdateIntentExamplesResponseDto> {
    const config = await this.prisma.intentExampleConfig.findUnique({
      where: { domain },
    });

    if (!config) {
      // No admin override — re-index from TS constants
      const group = INTENT_EXAMPLE_GROUPS.find((g) => g.name === domain);
      if (group) {
        return this.replaceDomain(domain, group.examples);
      }
      // Domain has no code examples and no admin config — nothing to reindex
      const domains = await getIntentDomains(this.prisma);
      if (domains.some((d) => d.label === domain)) {
        throw new NotFoundException(
          `Domain "${domain}" has no example sentences yet. Please add examples via Admin panel first.`,
        );
      }
      throw new NotFoundException(`Domain "${domain}" not found`);
    }

    const parsed = this.parseConfigSentences(config.sentences);
    return this.replaceDomain(domain, parsed?.flat ?? []);
  }

  /**
   * Test classification with a user input.
   */
  async testClassification(
    input: string,
  ): Promise<TestClassificationResponseDto> {
    const llmConfig: LlmProviderConfig = {
      type: this.configService.get<'online' | 'local'>('AI_LLM_TYPE', 'local'),
      model: this.configService.get<string>('OLLAMA_MODEL', 'qwen3.5:0.8b'),
      baseURL: this.configService.get<string>(
        'OLLAMA_BASE_URL',
        'http://localhost:11434',
      ),
    };
    const classifier = new IntentClassifier(
      this.aiService,
      this.prisma,
      this.meilisearchService,
      llmConfig,
    );
    const result = await classifier.classify(input);
    return {
      intent: result.intent,
      labels: result.labels,
      method: result.method,
      rawTop5: result.rawTop5,
    };
  }

  // ============================================================
  // Private helpers
  // ============================================================

  /**
   * Submit embedding jobs to BullMQ queue.
   *
   * 🏪 餐厅类比：服务员把化验单贴在窗口上
   * ────────────────────────────────────────────────────────────
   * 之前（旧代码）：服务员亲自跑化验室，一次等所有结果出来
   *   问题：30 个样本 × 5 秒 = 150 秒 > 120 秒超时
   *
   * 现在（新代码）：服务员把化验单贴在窗口上就回去工作了
   *   好处：
   *   1. API 立即返回（不再等待所有 embedding 完成）
   *   2. 化验室工作人员（EmbeddingProcessor）自己控制节奏
   *   3. concurrency:2 保证 Ollama 不被太多请求打爆
   *   4. 如果某个样本失败，自动重试（最多 3 次）
   *
   * @param domain 意图域名
   * @param sentences 要向量化的句子列表
   * @param configHash 配置哈希（用于追踪批次）
   * @returns 成功提交的任务数
   */

  private async submitEmbeddingJobs(
    domain: string,
    sentences: string[],
    configHash: string,
    meta?: EmbeddingJobMeta,
  ): Promise<number> {
    let submittedCount = 0;

    for (const sentence of sentences) {
      try {
        await this.embeddingQueue.add(
          'embed-sentence',
          {
            domain,
            sentence,
            configHash,
            ...meta,
          },
          {
            // 任务优先级：数字越小优先级越高
            priority: 1,
            // 失败时最多重试 3 次
            attempts: 3,
            // 重试延迟：第一次 5 秒，第二次 10 秒，第三次 15 秒
            backoff: {
              type: 'exponential',
              delay: 5000,
            },
          },
        );
        submittedCount++;
      } catch (error: any) {
        this.logger.error(
          `Failed to submit embedding job for "${sentence.slice(0, 40)}..." in "${domain}": ${error.message}`,
        );
      }
    }

    return submittedCount;
  }

  /**
   * Parse the config.sentences JSON field.
   * Supports both old format (flat string[]) and new format ({ flat, sections }).
   */
  private parseConfigSentences(
    raw: string,
  ): { flat: string[]; sections?: IntentExampleSectionDto[] } | null {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Old format: flat string[]
        return { flat: parsed };
      }
      if (parsed && Array.isArray(parsed.flat)) {
        // New format: { flat: string[], sections?: [...] }
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Parse a flat string array into structured sections.
   *
   * Detects coupon.ts format where sentences are organized by section comments.
   * If no section structure is detected, wraps all sentences in a single "General" section.
   */
  private parseIntoSections(sentences: string[]): IntentExampleSectionDto[] {
    // We can't detect sections from a flat array alone,
    // so we wrap in a single "General" section.
    // The frontend will parse sections from the pasted format before sending.
    return [{ section: 'General', sentences: [...sentences] }];
  }

  /**
   * Merge existing sections with new sections (for append mode).
   * Matches by section name, appends to existing or creates new.
   */
  private mergeSections(
    existing: IntentExampleSectionDto[],
    incoming: IntentExampleSectionDto[],
  ): IntentExampleSectionDto[] {
    const map = new Map<string, string[]>();
    for (const s of existing) {
      map.set(s.section, [...s.sentences]);
    }
    for (const s of incoming) {
      const existingSentences = map.get(s.section) ?? [];
      const set = new Set(existingSentences);
      for (const sentence of s.sentences) {
        if (!set.has(sentence)) {
          existingSentences.push(sentence);
          set.add(sentence);
        }
      }
      map.set(s.section, existingSentences);
    }
    return Array.from(map.entries()).map(([section, sentences]) => ({
      section,
      sentences,
    }));
  }

  /** Generate a short unique ID */
  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
}
