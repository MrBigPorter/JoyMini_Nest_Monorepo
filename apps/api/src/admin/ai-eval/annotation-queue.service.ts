import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { readdir, readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { isPrismaUniqueConstraintError } from '@api/common/prisma/prisma-error';
import {
  ANNOTATION_GUIDELINE_VERSION,
  PRELABEL_LABELER,
  worksheetScope,
  type AnnotationCorrectness,
  type AnnotationLabels,
  type PrelabelSuggestion,
} from './annotation-labels';

export {
  ANNOTATION_GUIDELINE_VERSION,
  PRELABEL_LABELER,
  type AnnotationCorrectness,
  type AnnotationLabels,
  type PrelabelSuggestion,
};

export interface AnnotationRow {
  caseId: string;
  turn: number;
  conversationId?: string;
  source?: string;
  language?: string;
  intent?: string;
  question: string;
  answer: string;
  status: 'pending' | 'done';
  labels: AnnotationLabels;
  labelerId: string;
  /** 当前展示的标签来自人工还是预标注；null 表示还没标注。 */
  labelSource: 'human' | 'prelabel' | null;
  confidence: number | null;
  guidelineVersion: string | null;
  /** 预标注建议单独保留，人工改判后仍可追溯。 */
  prelabel: PrelabelSuggestion | null;
  updatedAt: string | null;
}

const EMPTY_LABELS: AnnotationLabels = {
  correctness: null,
  comment: '',
};

/** DB 行 → 队列里的标签视图。 */
function labelsOf(row: {
  correctness: string | null;
  comment: string;
}): AnnotationLabels {
  return {
    correctness: (row.correctness as AnnotationCorrectness) ?? null,
    comment: row.comment ?? '',
  };
}

/**
 * 标注队列：样本仍来自本地工作表，标签落 `ai_eval_annotations`。
 *
 * 作用域写进 `runId`：工作表标注用 `worksheet:<文件名>`，不属于任何评测运行；
 * 运行级标注（校准用）直接写真实 run id。唯一键
 * `(run_id, case_id, turn, labeler_id)` 保证同一人同一用例只有一条。
 * JSONL 只作导出给离线 `annotate.py` 使用，不再作为写入源。
 */
@Injectable()
export class AnnotationQueueService {
  private readonly logger = new Logger(AnnotationQueueService.name);
  private readonly dir = resolve(
    process.cwd(),
    process.env.EVAL_ANNOTATION_DIR ??
      '../../tools/eval/conversation/annotations',
  );

  private readonly worksheetNamePattern = /^worksheet-[A-Za-z0-9._-]+\.jsonl$/;

  constructor(private readonly prisma: PrismaService) {}

  async listWorksheets(): Promise<string[]> {
    const names = await readdir(this.dir);
    return names.filter((name) => this.worksheetNamePattern.test(name)).sort();
  }

  /** 工作表文件名只允许简单名字，避免通过查询参数读到目录外文件。 */
  private async resolveWorksheet(
    name?: string,
  ): Promise<{ name: string; path: string }> {
    if (name) {
      if (!this.worksheetNamePattern.test(name)) {
        throw new NotFoundException('Invalid annotation worksheet name');
      }
      return { name, path: join(this.dir, name) };
    }

    const configured = process.env.EVAL_ANNOTATION_WORKSHEET;
    if (configured) {
      return {
        name: basename(configured),
        path: resolve(this.dir, configured),
      };
    }

    // 默认只认「日期型」工作表，smoke/实验工作表必须显式选择，
    // 否则新建一个 worksheet-smoke-* 就会把运营队列顶掉。
    const names = (await this.listWorksheets()).filter((n) =>
      /^worksheet-\d{4}-\d{2}-\d{2}\.jsonl$/.test(n),
    );
    if (names.length === 0) {
      throw new NotFoundException('No annotation worksheet found');
    }
    const last = names[names.length - 1];
    return { name: last, path: join(this.dir, last) };
  }

  private scopeOf(worksheetName: string): string {
    return worksheetScope(worksheetName);
  }

  private async readJsonl<T>(file: string): Promise<T[]> {
    try {
      const text = await readFile(file, 'utf8');
      return text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => JSON.parse(line) as T);
    } catch (error: any) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  }

  private async readAnnotations(scope: string, adminId: string) {
    return this.prisma.aiEvalAnnotation.findMany({
      where: { runId: scope, labelerId: { in: [adminId, PRELABEL_LABELER] } },
      orderBy: [{ caseId: 'asc' }, { turn: 'asc' }],
    });
  }

  async queue(
    adminId: string,
    status: 'pending' | 'done' | 'all' = 'all',
    worksheetName?: string,
  ): Promise<{ rows: AnnotationRow[]; total: number; done: number }> {
    const worksheet = await this.resolveWorksheet(worksheetName);
    const samples = await this.readJsonl<any>(worksheet.path);
    const saved = await this.readAnnotations(
      this.scopeOf(worksheet.name),
      adminId,
    );

    const humanByKey = new Map<string, (typeof saved)[number]>();
    const prelabelByKey = new Map<string, (typeof saved)[number]>();
    for (const row of saved) {
      const key = `${row.caseId}#${row.turn}`;
      if (row.labelerId === PRELABEL_LABELER || row.source === 'prelabel') {
        prelabelByKey.set(key, row);
      } else if (row.labelerId === adminId) {
        humanByKey.set(key, row);
      }
    }

    const rows: AnnotationRow[] = samples.map((sample) => {
      const key = `${sample.caseId}#${sample.turn}`;
      const human = humanByKey.get(key);
      const prelabel = prelabelByKey.get(key);
      const current = human ?? prelabel;
      return {
        caseId: sample.caseId,
        turn: sample.turn,
        conversationId: sample.conversationId,
        source: sample.source,
        language: sample.language,
        intent: sample.intent,
        question: sample.question,
        answer: sample.answer,
        status: human?.correctness ? 'done' : 'pending',
        labels: current ? labelsOf(current) : EMPTY_LABELS,
        labelerId: adminId,
        labelSource: human ? 'human' : prelabel ? 'prelabel' : null,
        confidence: human ? human.confidence : (prelabel?.confidence ?? null),
        guidelineVersion:
          human?.guidelineVersion ?? prelabel?.guidelineVersion ?? null,
        prelabel: prelabel
          ? {
              correctness:
                (prelabel.correctness as AnnotationCorrectness) ?? null,
              confidence: prelabel.confidence ?? null,
              guidelineVersion: prelabel.guidelineVersion,
            }
          : null,
        updatedAt: current?.updatedAt?.toISOString() ?? null,
      };
    });

    const done = rows.filter((row) => row.status === 'done').length;
    return {
      rows:
        status === 'all' ? rows : rows.filter((row) => row.status === status),
      total: rows.length,
      done,
    };
  }

  /** 并发写同一行时 upsert 可能报唯一键冲突，退回 update，不把 500 抛给标注者。 */
  private async writeAnnotation(params: {
    runId: string;
    caseId: string;
    turn: number;
    labelerId: string;
    data: {
      correctness: AnnotationCorrectness;
      comment: string;
      guidelineVersion: string;
      source: 'human' | 'prelabel';
      confidence: number | null;
    };
  }) {
    const where = {
      runId_caseId_turn_labelerId: {
        runId: params.runId,
        caseId: params.caseId,
        turn: params.turn,
        labelerId: params.labelerId,
      },
    };
    try {
      return await this.prisma.aiEvalAnnotation.upsert({
        where,
        create: {
          runId: params.runId,
          caseId: params.caseId,
          turn: params.turn,
          labelerId: params.labelerId,
          ...params.data,
        },
        update: params.data,
      });
    } catch (error) {
      if (!isPrismaUniqueConstraintError(error)) throw error;
      this.logger.warn(
        `[annotation-queue] unique conflict on ${params.runId}/${params.caseId}#${params.turn}, retrying as update`,
      );
      return this.prisma.aiEvalAnnotation.update({
        where,
        data: params.data,
      });
    }
  }

  async save(
    adminId: string,
    caseId: string,
    turn: number,
    labels: AnnotationLabels,
    options: { worksheet?: string; guidelineVersion?: string } = {},
  ): Promise<AnnotationRow> {
    const worksheet = await this.resolveWorksheet(options.worksheet);
    const samples = await this.readJsonl<any>(worksheet.path);
    const sample = samples.find(
      (row) => row.caseId === caseId && row.turn === turn,
    );
    if (!sample) throw new NotFoundException('Annotation row not found');

    const saved = await this.writeAnnotation({
      runId: this.scopeOf(worksheet.name),
      caseId,
      turn,
      labelerId: adminId,
      data: {
        correctness: labels.correctness ?? null,
        comment: labels.comment ?? '',
        guidelineVersion:
          options.guidelineVersion ?? ANNOTATION_GUIDELINE_VERSION,
        source: 'human',
        confidence: null,
      },
    });

    return {
      caseId,
      turn,
      conversationId: sample.conversationId,
      source: sample.source,
      language: sample.language,
      intent: sample.intent,
      question: sample.question,
      answer: sample.answer,
      status: saved.correctness ? 'done' : 'pending',
      labels: labelsOf(saved),
      labelerId: adminId,
      labelSource: 'human',
      confidence: saved.confidence ?? null,
      guidelineVersion: saved.guidelineVersion,
      prelabel: null,
      updatedAt: saved.updatedAt?.toISOString() ?? null,
    };
  }

  /**
   * 预标注落库：固定标注者 `prelabel`，带来源与置信度；
   * 人工另存一条，两者并存，改判后可对比。
   */
  async savePrelabel(input: {
    runId: string;
    caseId: string;
    turn: number;
    correctness: AnnotationCorrectness;
    confidence: number | null;
    guidelineVersion?: string;
  }): Promise<void> {
    await this.writeAnnotation({
      runId: input.runId,
      caseId: input.caseId,
      turn: input.turn,
      labelerId: PRELABEL_LABELER,
      data: {
        correctness: input.correctness ?? null,
        comment: '',
        guidelineVersion:
          input.guidelineVersion ?? ANNOTATION_GUIDELINE_VERSION,
        source: 'prelabel',
        confidence: input.confidence,
      },
    });
  }

  /** JSONL 仅导出，字段与离线 `annotate.py` 保持兼容（旧字段留空）。 */
  async exportJsonl(adminId: string, worksheetName?: string): Promise<string> {
    const { rows } = await this.queue(adminId, 'done', worksheetName);
    const lines = rows.map((row) =>
      JSON.stringify({
        caseId: row.caseId,
        conversationId: row.conversationId,
        turn: row.turn,
        source: row.source,
        language: row.language,
        intent: row.intent,
        question: row.question,
        answer: row.answer,
        labels: {
          correctness: row.labels.correctness,
          helpfulness: null,
          tone_safety: null,
          comment: row.labels.comment,
        },
        annotator: adminId,
        labelSource: row.labelSource,
        confidence: row.confidence,
        guidelineVersion: row.guidelineVersion,
        updatedAt: row.updatedAt,
      }),
    );
    return lines.length > 0 ? `${lines.join('\n')}\n` : '';
  }
}
