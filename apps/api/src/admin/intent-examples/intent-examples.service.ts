import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { AiService } from '@api/common/ai/ai.service';
import { IntentClassifier } from '@api/client/ai-customer/graph/utils/intent-classifier';
import { INTENT_EXAMPLE_GROUPS } from '@api/client/ai-customer/graph/agents/prompts/intent-examples';
import { md5 } from '@api/common/crypto.util';
import { EMBEDDING_QUEUE } from '@api/common/ai/queues/embedding/embedding-queue.constants';
import type { EmbeddingJobData } from '@api/common/ai/queues/embedding/embedding.processor';
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

    for (const { domain } of dbDomains) {
      seen.add(domain);
      const config = configMap.get(domain);
      const codeGroup = INTENT_EXAMPLE_GROUPS.find((g) => g.name === domain);
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

    // Add code-defined domains not yet in DB (e.g. after fresh seed)
    for (const group of INTENT_EXAMPLE_GROUPS) {
      if (!seen.has(group.name)) {
        result.push({
          name: group.name,
          examples: group.examples,
          requiredTags: group.requiredTags,
          hasAdminOverride: false,
          updatedAt: null,
          isAdminCreated: false,
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
    const group = INTENT_EXAMPLE_GROUPS.find((g) => g.name === domain);
    if (!group) {
      throw new NotFoundException(`Domain "${domain}" not found`);
    }

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
      name: group.name,
      examples:
        dbRows.length > 0 ? dbRows.map((r) => r.sentence) : group.examples,
      sections: parsed?.sections,
      requiredTags: group.requiredTags,
      hasAdminOverride: !!config,
      updatedAt: config?.updatedAt?.toISOString() ?? null,
      isAdminCreated: false,
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
    // Validate domain exists (either in code or in DB)
    const group = INTENT_EXAMPLE_GROUPS.find((g) => g.name === domain);
    const dbExists = await this.prisma.$queryRawUnsafe<{ cnt: number }[]>(
      `SELECT COUNT(*) as cnt FROM intent_examples WHERE domain = $1`,
      domain,
    );

    if (!group && dbExists[0].cnt === 0) {
      throw new NotFoundException(`Domain "${domain}" not found`);
    }

    if (mode === 'append') {
      return this.appendToDomain(domain, sentences, userId);
    }

    // 'replace' mode: full replacement
    return this.replaceDomain(domain, sentences, userId);
  }

  /**
   * Append new sentences to an existing domain (deduplicate by text).
   */
  private async appendToDomain(
    domain: string,
    newSentences: string[],
    userId?: string,
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

    // Update config: merge sections
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
    }

    // Submit only new sentences to embedding queue
    const jobCount = await this.submitEmbeddingJobs(domain, trulyNew, newHash);

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
      if (!group) {
        throw new NotFoundException(`Domain "${domain}" not found`);
      }
      return this.replaceDomain(domain, group.examples);
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
    const classifier = new IntentClassifier(this.aiService, this.prisma);
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
