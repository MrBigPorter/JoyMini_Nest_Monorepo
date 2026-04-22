import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';

@Injectable()
export class TranslationJobService {
  private readonly logger = new Logger(TranslationJobService.name);

  constructor(private prisma: PrismaService) {}

  async createJob(
    type: string,
    targetId: string,
    targetLang: string,
  ): Promise<string> {
    const job = await this.prisma.translationJob.create({
      data: {
        type,
        targetId,
        targetLang,
        status: 'QUEUED',
        progress: 0,
      },
    });
    this.logger.debug(
      `Created translation job: ${job.id} (${type}:${targetId} -> ${targetLang})`,
    );
    return job.id;
  }

  async updateProgress(
    jobId: string,
    progress: number,
    status?: string,
    errorMsg?: string,
  ): Promise<void> {
    const data: any = { progress };
    if (status) data.status = status;
    if (errorMsg) data.errorMsg = errorMsg;
    if (status === 'PROCESSING') data.startedAt = new Date();
    if (status === 'COMPLETED' || status === 'FAILED')
      data.completedAt = new Date();

    await this.prisma.translationJob
      .update({
        where: { id: jobId },
        data,
      })
      .catch((err) => {
        this.logger.warn(`Failed to update job ${jobId}: ${err.message}`);
      });
  }

  async getJobsByStatus(status?: string) {
    const where: any = {};
    if (status) where.status = status;

    return this.prisma.translationJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async getStatsByLanguage() {
    const jobs = await this.prisma.translationJob.groupBy({
      by: ['targetLang', 'status'],
      _count: true,
    });

    const stats: Record<string, Record<string, number>> = {};
    for (const row of jobs) {
      if (!stats[row.targetLang]) stats[row.targetLang] = {};
      stats[row.targetLang][row.status] = row._count;
    }
    return stats;
  }

  async getStats() {
    const [queued, processing, completed, failed] = await Promise.all([
      this.prisma.translationJob.count({ where: { status: 'QUEUED' } }),
      this.prisma.translationJob.count({ where: { status: 'PROCESSING' } }),
      this.prisma.translationJob.count({ where: { status: 'COMPLETED' } }),
      this.prisma.translationJob.count({ where: { status: 'FAILED' } }),
    ]);
    return { queued, processing, completed, failed };
  }

  async getDetail(
    targetLang?: string,
    status?: string[],
    page?: number,
    pageSize?: number,
  ) {
    const where: any = {};
    if (targetLang) where.targetLang = targetLang;
    if (status && status.length > 0) where.status = { in: status };

    const skip = page && pageSize ? (page - 1) * pageSize : undefined;
    const take = pageSize || 200;

    const [jobs, total] = await Promise.all([
      this.prisma.translationJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          article: {
            select: {
              id: true,
              title: true,
              titleLocalized: true,
            },
          },
          category: {
            select: {
              id: true,
              name: true,
            },
          },
          tag: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
      this.prisma.translationJob.count({ where }),
    ]);

    const items = jobs.map((j) => {
      let targetName = '';
      if (j.type === 'article' && j.article) {
        targetName = j.article.title || `文章 ${j.targetId.substring(0, 8)}`;
      } else if (j.type === 'category' && j.category) {
        const name = j.category.name;
        targetName =
          typeof name === 'object' && name !== null && !Array.isArray(name)
            ? (name as any).zh || `分类 ${j.targetId.substring(0, 8)}`
            : String(name || `分类 ${j.targetId.substring(0, 8)}`);
      } else if (j.type === 'tag' && j.tag) {
        const name = j.tag.name;
        targetName =
          typeof name === 'object' && name !== null && !Array.isArray(name)
            ? (name as any).zh || `标签 ${j.targetId.substring(0, 8)}`
            : String(name || `标签 ${j.targetId.substring(0, 8)}`);
      } else {
        targetName = `${j.type} ${j.targetId.substring(0, 8)}`;
      }

      return {
        id: j.id,
        type: j.type,
        targetId: j.targetId,
        targetName,
        targetLang: j.targetLang,
        status: j.status,
        progress: j.progress,
        errorMsg: j.errorMsg,
        createdAt: j.createdAt,
        startedAt: j.startedAt,
        completedAt: j.completedAt,
      };
    });

    return {
      items,
      total,
      page: page || 1,
      pageSize: take,
      totalPages: Math.max(1, Math.ceil(total / take)),
    };
  }
}
