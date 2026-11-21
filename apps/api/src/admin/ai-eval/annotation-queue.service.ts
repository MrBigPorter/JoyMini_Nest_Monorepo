import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export interface AnnotationLabels {
  correctness: 'solved' | 'partial' | 'unsolved' | 'unsafe' | 'abstain' | null;
  helpfulness: number | null;
  tone_safety: number | null;
  comment: string;
}

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
}

const EMPTY_LABELS: AnnotationLabels = {
  correctness: null,
  helpfulness: null,
  tone_safety: null,
  comment: '',
};

/**
 * 标注队列：以 JSONL 工作表为源，按管理员各写一份标注文件。
 *
 * 这是内部运营工具，不引入新表；写文件用临时文件 + rename 原子替换，
 * 同一进程内串行写，避免并发覆盖。多实例部署时需要换成 DB 或加分布式锁。
 */
@Injectable()
export class AnnotationQueueService {
  private readonly logger = new Logger(AnnotationQueueService.name);
  private readonly dir = resolve(
    process.cwd(),
    process.env.EVAL_ANNOTATION_DIR ??
      '../../tools/eval/conversation/annotations',
  );
  private writeChain: Promise<void> = Promise.resolve();

  private safeId(adminId: string): string {
    return adminId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'anon';
  }

  private annotationFile(adminId: string): string {
    return join(this.dir, `annotations-${this.safeId(adminId)}.jsonl`);
  }

  private async worksheetFile(): Promise<string> {
    const configured = process.env.EVAL_ANNOTATION_WORKSHEET;
    if (configured) return resolve(this.dir, configured);
    const names = (await readdir(this.dir))
      .filter((name) => /^worksheet-.*\.jsonl$/.test(name))
      .sort();
    if (names.length === 0) {
      throw new NotFoundException('No annotation worksheet found');
    }
    return join(this.dir, names[names.length - 1]);
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

  private labelsOf(row: any): AnnotationLabels {
    const labels = row?.labels ?? {};
    return {
      correctness: labels.correctness ?? null,
      helpfulness: labels.helpfulness ?? null,
      tone_safety: labels.tone_safety ?? null,
      comment: typeof labels.comment === 'string' ? labels.comment : '',
    };
  }

  async queue(
    adminId: string,
    status: 'pending' | 'done' | 'all' = 'all',
  ): Promise<{ rows: AnnotationRow[]; total: number; done: number }> {
    const worksheet = await this.readJsonl<any>(await this.worksheetFile());
    const saved = new Map(
      (await this.readJsonl<any>(this.annotationFile(adminId))).map((row) => [
        `${row.caseId}#${row.turn}`,
        this.labelsOf(row),
      ]),
    );

    const rows: AnnotationRow[] = worksheet.map((row) => {
      const labels = saved.get(`${row.caseId}#${row.turn}`) ?? EMPTY_LABELS;
      return {
        caseId: row.caseId,
        turn: row.turn,
        conversationId: row.conversationId,
        source: row.source,
        language: row.language,
        intent: row.intent,
        question: row.question,
        answer: row.answer,
        status: labels.correctness ? 'done' : 'pending',
        labels,
      };
    });

    const done = rows.filter((row) => row.status === 'done').length;
    return {
      rows:
        status === 'all'
          ? rows
          : rows.filter((row) => row.status === status),
      total: rows.length,
      done,
    };
  }

  async save(
    adminId: string,
    caseId: string,
    turn: number,
    labels: AnnotationLabels,
  ): Promise<AnnotationRow> {
    const worksheet = await this.readJsonl<any>(await this.worksheetFile());
    const source = worksheet.find(
      (row) => row.caseId === caseId && row.turn === turn,
    );
    if (!source) throw new NotFoundException('Annotation row not found');

    const file = this.annotationFile(adminId);
    const saved = await this.readJsonl<any>(file);
    const key = `${caseId}#${turn}`;
    const next = saved.filter(
      (row) => `${row.caseId}#${row.turn}` !== key,
    );
    next.push({
      ...source,
      labels,
      annotator: adminId,
      updatedAt: new Date().toISOString(),
    });
    next.sort((a, b) =>
      `${a.caseId}#${a.turn}`.localeCompare(`${b.caseId}#${b.turn}`),
    );

    await this.enqueueWrite(async () => {
      const temp = `${file}.${process.pid}.tmp`;
      await writeFile(
        temp,
        `${next.map((row) => JSON.stringify(row)).join('\n')}\n`,
        'utf8',
      );
      await rename(temp, file);
    });

    return {
      caseId: source.caseId,
      turn: source.turn,
      conversationId: source.conversationId,
      source: source.source,
      language: source.language,
      intent: source.intent,
      question: source.question,
      answer: source.answer,
      status: labels.correctness ? 'done' : 'pending',
      labels,
    };
  }

  private enqueueWrite(task: () => Promise<void>): Promise<void> {
    const run = this.writeChain.then(task, task);
    this.writeChain = run.catch((error: any) => {
      this.logger.warn(
        `[annotation-queue] write failed: ${error?.message ?? error}`,
      );
    });
    return run;
  }
}
