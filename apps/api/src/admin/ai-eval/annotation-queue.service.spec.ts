import { NotFoundException } from '@nestjs/common';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AnnotationQueueService,
  PRELABEL_LABELER,
} from './annotation-queue.service';

function worksheetRow(caseId: string, turn: number) {
  return JSON.stringify({
    caseId,
    conversationId: `conv-${caseId}`,
    turn,
    source: 'sim',
    language: 'zh',
    intent: 'general',
    question: `q-${caseId}-${turn}`,
    answer: `a-${caseId}-${turn}`,
    labels: {},
  });
}

function annotationRow(overrides: Record<string, any>) {
  return {
    id: 'ann-1',
    runId: 'worksheet:worksheet-2026-11-21.jsonl',
    caseId: 'prod',
    turn: 1,
    labelerId: 'admin-1',
    correctness: null,
    comment: '',
    guidelineVersion: 'annotation-guide-v1',
    source: 'human',
    confidence: null,
    createdAt: new Date('2026-11-21T00:00:00Z'),
    updatedAt: new Date('2026-11-21T00:00:00Z'),
    ...overrides,
  };
}

function createPrisma() {
  return {
    aiEvalAnnotation: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest
        .fn()
        .mockImplementation(async ({ create }: any) => annotationRow(create)),
      update: jest
        .fn()
        .mockImplementation(async ({ data }: any) => annotationRow(data)),
    },
  };
}

describe('AnnotationQueueService · 工作表选择', () => {
  let dir: string;
  let service: AnnotationQueueService;
  let prisma: ReturnType<typeof createPrisma>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'annotation-'));
    await writeFile(
      join(dir, 'worksheet-2026-11-21.jsonl'),
      `${worksheetRow('prod', 1)}\n`,
    );
    await writeFile(
      join(dir, 'worksheet-smoke-2026-11-21.jsonl'),
      `${worksheetRow('smoke', 1)}\n${worksheetRow('smoke', 2)}\n`,
    );
    await writeFile(join(dir, 'notes.txt'), 'ignored');
    prisma = createPrisma();
    service = new AnnotationQueueService(prisma as any);
    (service as any).dir = dir;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('默认仍选日期型工作表，smoke 不会顶掉运营队列', async () => {
    const result = await service.queue('admin-1', 'all');
    expect(result.rows.map((r) => r.caseId)).toEqual(['prod']);
  });

  it('显式指定 smoke 工作表时读取 smoke', async () => {
    const result = await service.queue(
      'admin-1',
      'all',
      'worksheet-smoke-2026-11-21.jsonl',
    );
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].caseId).toBe('smoke');
  });

  it('拒绝目录穿越或非法文件名', async () => {
    await expect(
      service.queue('admin-1', 'all', '../worksheet-2026-11-21.jsonl'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.queue('admin-1', 'all', 'notes.txt'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('列出所有工作表供选择', async () => {
    await expect(service.listWorksheets()).resolves.toEqual([
      'worksheet-2026-11-21.jsonl',
      'worksheet-smoke-2026-11-21.jsonl',
    ]);
  });
});

describe('AnnotationQueueService · 落库', () => {
  let dir: string;
  let service: AnnotationQueueService;
  let prisma: ReturnType<typeof createPrisma>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'annotation-'));
    await writeFile(
      join(dir, 'worksheet-2026-11-21.jsonl'),
      `${worksheetRow('prod', 1)}\n`,
    );
    prisma = createPrisma();
    service = new AnnotationQueueService(prisma as any);
    (service as any).dir = dir;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('保存写库：作用域、用例、轮次、标注者组成唯一键', async () => {
    await service.save('admin-1', 'prod', 1, {
      correctness: 'solved',
      comment: '答得对',
    });

    expect(prisma.aiEvalAnnotation.upsert).toHaveBeenCalledTimes(1);
    const arg = prisma.aiEvalAnnotation.upsert.mock.calls[0][0];
    expect(arg.where.runId_caseId_turn_labelerId).toEqual({
      runId: 'worksheet:worksheet-2026-11-21.jsonl',
      caseId: 'prod',
      turn: 1,
      labelerId: 'admin-1',
    });
    expect(arg.create).toMatchObject({
      correctness: 'solved',
      comment: '答得对',
      source: 'human',
      confidence: null,
      guidelineVersion: expect.any(String),
    });
  });

  it('保存前校验样本存在，工作表里没有的用例拒绝写入', async () => {
    await expect(
      service.save('admin-1', 'missing', 1, {
        correctness: 'solved',
        comment: '',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.aiEvalAnnotation.upsert).not.toHaveBeenCalled();
  });

  it('两人标注同一用例并存：查询只带自己的标注与预标注', async () => {
    prisma.aiEvalAnnotation.findMany.mockResolvedValue([
      annotationRow({
        labelerId: 'admin-1',
        correctness: 'solved',
        comment: '我判解决',
      }),
      annotationRow({
        id: 'ann-2',
        labelerId: 'admin-2',
        correctness: 'unsolved',
        comment: '我判没解决',
      }),
    ]);

    const result = await service.queue('admin-1', 'all');

    expect(prisma.aiEvalAnnotation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          labelerId: { in: ['admin-1', PRELABEL_LABELER] },
        }),
      }),
    );
    expect(result.rows[0].labels.correctness).toBe('solved');
    expect(result.rows[0].labels.comment).toBe('我判解决');
    expect(result.rows[0].labelerId).toBe('admin-1');
  });

  it('唯一键冲突（并发写同一行）改为更新，不把 500 抛给标注者', async () => {
    prisma.aiEvalAnnotation.upsert.mockRejectedValueOnce({ code: 'P2002' });

    const saved = await service.save('admin-1', 'prod', 1, {
      correctness: 'partial',
      comment: '再写一次',
    });

    expect(prisma.aiEvalAnnotation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          runId_caseId_turn_labelerId: {
            runId: 'worksheet:worksheet-2026-11-21.jsonl',
            caseId: 'prod',
            turn: 1,
            labelerId: 'admin-1',
          },
        },
      }),
    );
    expect(saved.labels.correctness).toBe('partial');
  });

  it('预标注落库带来源与置信度，人工可区分且修改后仍可追溯', async () => {
    await service.savePrelabel({
      runId: 'worksheet:worksheet-2026-11-21.jsonl',
      caseId: 'prod',
      turn: 1,
      correctness: 'solved',
      confidence: 0.82,
      guidelineVersion: 'annotation-guide-v1',
    });

    const prelabelArg = prisma.aiEvalAnnotation.upsert.mock.calls[0][0];
    expect(prelabelArg.create).toMatchObject({
      labelerId: PRELABEL_LABELER,
      source: 'prelabel',
      confidence: 0.82,
    });

    prisma.aiEvalAnnotation.findMany.mockResolvedValue([
      annotationRow({
        labelerId: PRELABEL_LABELER,
        source: 'prelabel',
        correctness: 'solved',
        confidence: 0.82,
      }),
      annotationRow({
        id: 'ann-human',
        labelerId: 'admin-1',
        source: 'human',
        correctness: 'unsolved',
      }),
    ]);

    const result = await service.queue('admin-1', 'all');
    expect(result.rows[0].labels.correctness).toBe('unsolved');
    expect(result.rows[0].labelSource).toBe('human');
    expect(result.rows[0].prelabel).toMatchObject({
      correctness: 'solved',
      confidence: 0.82,
    });
    expect(result.done).toBe(1);
  });

  it('只有预标注时仍为待标注，并展示预标注来源', async () => {
    prisma.aiEvalAnnotation.findMany.mockResolvedValue([
      annotationRow({
        labelerId: PRELABEL_LABELER,
        source: 'prelabel',
        correctness: 'solved',
        confidence: 0.7,
      }),
    ]);

    const result = await service.queue('admin-1', 'pending');

    expect(result.rows[0].status).toBe('pending');
    expect(result.rows[0].labelSource).toBe('prelabel');
    expect(result.rows[0].confidence).toBe(0.7);
  });

  it('导出 JSONL 兼容离线脚本：保留 caseId/turn 与已删除字段的空位', async () => {
    prisma.aiEvalAnnotation.findMany.mockResolvedValue([
      annotationRow({
        labelerId: 'admin-1',
        correctness: 'solved',
        comment: 'ok',
      }),
    ]);

    const text = await service.exportJsonl('admin-1');
    const line = JSON.parse(text.split('\n')[0]);

    expect(line.caseId).toBe('prod');
    expect(line.turn).toBe(1);
    expect(line.annotator).toBe('admin-1');
    expect(line.labels).toEqual({
      correctness: 'solved',
      helpfulness: null,
      tone_safety: null,
      comment: 'ok',
    });
    expect(line.labelSource).toBe('human');
    expect(line.guidelineVersion).toBe('annotation-guide-v1');
  });
});
