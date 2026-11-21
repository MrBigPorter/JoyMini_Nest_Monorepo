import { Injectable, Logger } from '@nestjs/common';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export interface EvalReportSummary {
  file: string;
  runId: string;
  datasetVersion: string;
  generatedAt: string;
  mode: string;
  gatePassed: boolean;
  conversationCount: number;
  drillCount: number;
  aggregates: Record<string, unknown>;
  gates: Array<{ key: string; label: string; ok: boolean; detail: string }>;
  fairness: Array<{
    dimension: string;
    key: string;
    spread: number | null;
    flagged: boolean;
    note: string;
  }>;
}

/**
 * 读取定时评测生成的 JSON 报告（只读）。
 *
 * 报告目录由 EVAL_REPORT_DIR 指定；默认相对 apps/api 的
 * ../../tools/eval/conversation/reports。只读 *.json，忽略 feedback。
 */
@Injectable()
export class EvalReportsService {
  private readonly logger = new Logger(EvalReportsService.name);
  private readonly reportDir = resolve(
    process.cwd(),
    process.env.EVAL_REPORT_DIR ?? '../../tools/eval/conversation/reports',
  );

  async list(limit = 20): Promise<EvalReportSummary[]> {
    let names: string[] = [];
    try {
      names = await readdir(this.reportDir);
    } catch (error: any) {
      this.logger.warn(
        `[eval-reports] cannot read ${this.reportDir}: ${error?.message ?? error}`,
      );
      return [];
    }

    const files = names
      .filter((name) => name.endsWith('.json') && !name.includes('.feedback.'))
      .map((name) => join(this.reportDir, name));

    const withTime = await Promise.all(
      files.map(async (file) => ({
        file,
        mtime: (await stat(file)).mtimeMs,
      })),
    );
    withTime.sort((a, b) => b.mtime - a.mtime);

    const reports: EvalReportSummary[] = [];
    for (const item of withTime.slice(0, limit)) {
      try {
        const parsed = JSON.parse(await readFile(item.file, 'utf8'));
        reports.push({
          file: item.file.split('/').pop() ?? item.file,
          runId: String(parsed.runId ?? ''),
          datasetVersion: String(parsed.datasetVersion ?? ''),
          generatedAt: String(parsed.generatedAt ?? ''),
          mode: String(parsed.mode ?? 'advisory'),
          gatePassed: Boolean(parsed.gatePassed),
          conversationCount: Array.isArray(parsed.conversations)
            ? parsed.conversations.length
            : 0,
          drillCount: Array.isArray(parsed.drillConversations)
            ? parsed.drillConversations.length
            : 0,
          aggregates: parsed.aggregates ?? {},
          gates: Array.isArray(parsed.gates) ? parsed.gates : [],
          fairness: Array.isArray(parsed.fairness) ? parsed.fairness : [],
        });
      } catch (error: any) {
        this.logger.warn(
          `[eval-reports] skip ${item.file}: ${error?.message ?? error}`,
        );
      }
    }
    return reports;
  }

  async latest(): Promise<EvalReportSummary | null> {
    const [first] = await this.list(1);
    return first ?? null;
  }
}
