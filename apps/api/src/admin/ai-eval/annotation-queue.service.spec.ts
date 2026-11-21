import { NotFoundException } from '@nestjs/common';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnnotationQueueService } from './annotation-queue.service';

function row(caseId: string, turn: number) {
  return JSON.stringify({
    caseId,
    conversationId: `conv-${caseId}`,
    turn,
    source: 'sim',
    language: 'zh',
    intent: 'general',
    question: `q-${caseId}-${turn}`,
    answer: `a-${caseId}-${turn}`,
    labels: {
      correctness: null,
      helpfulness: null,
      tone_safety: null,
      comment: '',
    },
  });
}

describe('AnnotationQueueService · 工作表选择', () => {
  let dir: string;
  let service: AnnotationQueueService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'annotation-'));
    await writeFile(
      join(dir, 'worksheet-2026-11-21.jsonl'),
      `${row('prod', 1)}\n`,
    );
    await writeFile(
      join(dir, 'worksheet-smoke-2026-11-21.jsonl'),
      `${row('smoke', 1)}\n${row('smoke', 2)}\n`,
    );
    await writeFile(join(dir, 'notes.txt'), 'ignored');
    service = new AnnotationQueueService();
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
