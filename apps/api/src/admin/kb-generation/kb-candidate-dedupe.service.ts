import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { AiService } from '@api/common/ai/ai.service';
import {
  hashCandidateText,
  normalizeCandidateText,
} from './kb-candidate-text.util';
import { RawGoldenQuery } from './kb-generation.types';

const VECTOR_DUPLICATE_THRESHOLD = 0.92;

export interface DedupedText {
  text: string;
  normalizedHash: string;
  nearestScore?: number;
}

export interface DedupeOutcome {
  kept: DedupedText[];
  dropped: number;
  reasons: Record<string, number>;
}

/**
 * 候选去重：精确（规范化文本）+ 同域向量近邻。
 *
 * 不保存候选向量：批准时用当时的模型重新嵌入，换 embedding 模型后
 * 仍然正确；这里只在生成时临时算一次。
 */
@Injectable()
export class KbCandidateDedupeService {
  private readonly logger = new Logger(KbCandidateDedupeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
  ) {}

  async dedupeIntentExamples(
    domain: string,
    texts: string[],
  ): Promise<DedupeOutcome> {
    const kept: DedupedText[] = [];
    const reasons: Record<string, number> = {};
    const seen = new Set<string>();
    let dropped = 0;

    for (const text of texts) {
      const normalizedHash = hashCandidateText(text);

      if (seen.has(normalizedHash)) {
        dropped += 1;
        reasons.duplicate_in_batch = (reasons.duplicate_in_batch ?? 0) + 1;
        continue;
      }
      seen.add(normalizedHash);

      if (
        await this.existsInIntentExamples(domain, normalizeCandidateText(text))
      ) {
        dropped += 1;
        reasons.exists_in_intent_examples =
          (reasons.exists_in_intent_examples ?? 0) + 1;
        continue;
      }

      if (await this.existsInPendingCandidates(domain, normalizedHash)) {
        dropped += 1;
        reasons.exists_in_pending_candidates =
          (reasons.exists_in_pending_candidates ?? 0) + 1;
        continue;
      }

      const nearest = await this.nearestIntentExampleSimilarity(domain, text);
      if (
        nearest.score !== null &&
        nearest.score >= VECTOR_DUPLICATE_THRESHOLD
      ) {
        dropped += 1;
        reasons.semantic_duplicate = (reasons.semantic_duplicate ?? 0) + 1;
        continue;
      }

      kept.push({
        text,
        normalizedHash,
        nearestScore: nearest.score ?? undefined,
      });
    }

    return { kept, dropped, reasons };
  }

  async dedupeGoldenQueries(
    documentId: string,
    queries: RawGoldenQuery[],
  ): Promise<{
    kept: Array<RawGoldenQuery & { normalizedHash: string }>;
    dropped: number;
    reasons: Record<string, number>;
  }> {
    const kept: Array<RawGoldenQuery & { normalizedHash: string }> = [];
    const reasons: Record<string, number> = {};
    const seen = new Set<string>();
    let dropped = 0;

    for (const query of queries) {
      const normalizedHash = hashCandidateText(query.query);
      if (seen.has(normalizedHash)) {
        dropped += 1;
        reasons.duplicate_in_batch = (reasons.duplicate_in_batch ?? 0) + 1;
        continue;
      }
      seen.add(normalizedHash);

      const exists = await this.prisma.$queryRawUnsafe<Array<{ hit: number }>>(
        `SELECT 1 AS hit
           FROM kb_synthetic_golden
          WHERE document_id = $1
            AND regexp_replace(lower(btrim(query)), '\\s+', ' ', 'g') = $2
          LIMIT 1`,
        documentId,
        normalizeCandidateText(query.query),
      );
      if (exists.length > 0) {
        dropped += 1;
        reasons.exists_in_synthetic_golden =
          (reasons.exists_in_synthetic_golden ?? 0) + 1;
        continue;
      }

      kept.push({ ...query, normalizedHash });
    }

    return { kept, dropped, reasons };
  }

  private async existsInIntentExamples(
    domain: string,
    normalizedText: string,
  ): Promise<boolean> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ hit: number }>>(
      `SELECT 1 AS hit
         FROM intent_examples
        WHERE domain = $1
          AND regexp_replace(lower(btrim(sentence)), '\\s+', ' ', 'g') = $2
        LIMIT 1`,
      domain,
      normalizedText,
    );
    return rows.length > 0;
  }

  private async existsInPendingCandidates(
    domain: string,
    normalizedHash: string,
  ): Promise<boolean> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ hit: number }>>(
      `SELECT 1 AS hit
         FROM kb_generation_candidates
        WHERE kind = 'INTENT_EXAMPLE'
          AND target_domain = $1
          AND normalized_hash = $2
          AND status IN ('PENDING', 'APPROVED', 'APPLIED', 'AUTO_APPLIED')
        LIMIT 1`,
      domain,
      normalizedHash,
    );
    return rows.length > 0;
  }

  private async nearestIntentExampleSimilarity(
    domain: string,
    text: string,
  ): Promise<{ score: number | null }> {
    const vector = await this.aiService.generateEmbedding(text, {
      task: 'retrieval.query',
    });
    if (!vector || vector.length === 0) return { score: null };

    try {
      const rows = await this.prisma.$queryRawUnsafe<
        Array<{ similarity: number }>
      >(
        `SELECT 1 - (embedding <=> $2::vector) AS similarity
           FROM intent_examples
          WHERE domain = $1
            AND embedding IS NOT NULL
          ORDER BY embedding <=> $2::vector
          LIMIT 1`,
        domain,
        `[${vector.join(',')}]`,
      );
      return { score: rows[0]?.similarity ?? null };
    } catch (error) {
      this.logger.warn(
        `Nearest-intent lookup failed for domain ${domain}: ${(error as Error).message}`,
      );
      return { score: null };
    }
  }
}
