import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { AiEvalJudgeService } from './ai-eval-judge.service';
import { AddEvalCasesDto } from './dto/eval-dataset.dto';

@Injectable()
export class AiEvalDatasetService {
  private readonly logger = new Logger(AiEvalDatasetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly judge: AiEvalJudgeService,
  ) {}

  async listDatasets() {
    return this.prisma.aiEvalDataset.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { cases: true, runs: true } } },
    });
  }

  async createDataset(input: {
    name: string;
    description?: string;
    createdBy?: string;
  }) {
    return this.prisma.aiEvalDataset.create({
      data: {
        name: input.name,
        description: input.description,
        createdBy: input.createdBy,
      },
    });
  }

  async getDataset(id: string) {
    const dataset = await this.prisma.aiEvalDataset.findUnique({
      where: { id },
      include: {
        cases: { orderBy: { createdAt: 'asc' } },
        runs: {
          orderBy: { startedAt: 'desc' },
          take: 20,
        },
      },
    });
    if (!dataset) throw new NotFoundException('Eval dataset not found');
    return dataset;
  }

  async addCases(datasetId: string, dto: AddEvalCasesDto) {
    const dataset = await this.prisma.aiEvalDataset.findUnique({
      where: { id: datasetId },
      select: { id: true },
    });
    if (!dataset) throw new NotFoundException('Eval dataset not found');

    await this.prisma.aiEvalCase.createMany({
      data: dto.cases.map((item) => ({
        datasetId,
        question: item.question,
        answer: item.answer,
        expect: (item.expect ?? {}) as any,
        tags: (item.tags ?? []) as any,
      })),
    });
    return this.getDataset(datasetId);
  }

  async startRun(datasetId: string, createdBy?: string) {
    const dataset = await this.prisma.aiEvalDataset.findUnique({
      where: { id: datasetId },
      include: { cases: true },
    });
    if (!dataset) throw new NotFoundException('Eval dataset not found');
    if (dataset.cases.length === 0) {
      throw new NotFoundException('Eval dataset has no cases');
    }

    const run = await this.prisma.aiEvalRun.create({
      data: { datasetId, createdBy },
    });
    void this.executeRun(run.id).catch((err) => {
      this.logger.error(`Eval run ${run.id} failed: ${err?.message ?? err}`);
    });
    return run;
  }

  async getRun(id: string) {
    const run = await this.prisma.aiEvalRun.findUnique({
      where: { id },
      include: {
        results: {
          include: { case: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!run) throw new NotFoundException('Eval run not found');
    return run;
  }

  private async executeRun(runId: string): Promise<void> {
    const run = await this.prisma.aiEvalRun.findUnique({
      where: { id: runId },
      include: { dataset: { include: { cases: true } } },
    });
    if (!run) return;

    let solved = 0;
    let partial = 0;
    let unsolved = 0;
    try {
      for (const item of run.dataset.cases) {
        const started = Date.now();
        const verdict = await this.judge.judge({
          question: item.question,
          answer: item.answer,
          expectTask: (item.expect ?? {}) as any,
          pendingConfirm: null,
        });
        if (verdict.verdict === 'solved') solved += 1;
        else if (verdict.verdict === 'partial') partial += 1;
        else unsolved += 1;

        await this.prisma.aiEvalResult.create({
          data: {
            runId,
            caseId: item.id,
            verdict: verdict.verdict,
            score: verdict.score,
            reason: verdict.reason,
            latencyMs: Date.now() - started,
          },
        });
      }
      await this.prisma.aiEvalRun.update({
        where: { id: runId },
        data: {
          status: 'COMPLETED',
          finishedAt: new Date(),
          summary: {
            total: run.dataset.cases.length,
            solved,
            partial,
            unsolved,
            passRate:
              run.dataset.cases.length > 0
                ? Number((solved / run.dataset.cases.length).toFixed(3))
                : 0,
          },
        },
      });
    } catch (err: any) {
      await this.prisma.aiEvalRun.update({
        where: { id: runId },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          summary: { error: String(err?.message ?? err).slice(0, 300) },
        },
      });
      throw err;
    }
  }
}
