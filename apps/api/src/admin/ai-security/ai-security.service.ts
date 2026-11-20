import { Injectable } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { QuerySecurityEventsDto } from './dto/query-security.dto';

@Injectable()
export class AiSecurityService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: QuerySecurityEventsDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = this.buildWhere(query);
    const [list, total] = await this.prisma.$transaction([
      this.prisma.aiSecurityEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.aiSecurityEvent.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  async triage(
    id: string,
    input: { status?: string; note?: string },
    adminId: string,
  ) {
    return this.prisma.aiSecurityEvent.update({
      where: { id },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.note !== undefined ? { note: input.note.slice(0, 500) } : {}),
        ...(input.status
          ? { reviewedBy: adminId, reviewedAt: new Date() }
          : {}),
      },
    });
  }

  async summary(query: QuerySecurityEventsDto) {
    const where = this.buildWhere(query);
    const [total, byType, byMode, byStatus, latest] = await Promise.all([
      this.prisma.aiSecurityEvent.count({ where }),
      this.prisma.aiSecurityEvent.groupBy({
        by: ['type'],
        where,
        _count: { id: true },
      }),
      this.prisma.aiSecurityEvent.groupBy({
        by: ['mode'],
        where,
        _count: { id: true },
      }),
      this.prisma.aiSecurityEvent.groupBy({
        by: ['status'],
        where,
        _count: { id: true },
      }),
      this.prisma.aiSecurityEvent.findFirst({
        where,
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    return {
      total,
      byType: byType.map((row) => ({
        type: row.type,
        count: row._count.id,
      })),
      byMode: byMode.map((row) => ({
        mode: row.mode,
        count: row._count.id,
      })),
      byStatus: byStatus.map((row) => ({
        status: row.status,
        count: row._count.id,
      })),
      latestAt: latest?.createdAt ?? null,
      mode: process.env.AI_INJECTION_DETECTION_MODE ?? 'off',
    };
  }

  private buildWhere(query: QuerySecurityEventsDto) {
    return {
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from
                ? { gte: new Date(`${query.from}T00:00:00.000Z`) }
                : {}),
              ...(query.to
                ? { lte: new Date(`${query.to}T23:59:59.999Z`) }
                : {}),
            },
          }
        : {}),
    };
  }
}
