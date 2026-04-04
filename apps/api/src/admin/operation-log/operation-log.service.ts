import { Injectable } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { QueryOperationLogDto } from './dto/query-operation-log.dto';
import { Prisma } from '@prisma/client';
import { TimeHelper } from '@lucky/shared';

const GENERIC_ACTION_FILTERS = new Set([
  'login',
  'logout',
  'create',
  'update',
  'delete',
  'audit',
  'export',
]);

export interface WriteLogParams {
  adminId: string;
  adminName: string;
  module: string;
  action: string;
  details?: string;
  requestIp?: string;
}

@Injectable()
export class OperationLogService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 写入一条操作日志（供其他 Service 调用）
   */
  async log(params: WriteLogParams): Promise<void> {
    await this.prisma.adminOperationLog.create({
      data: {
        adminId: params.adminId,
        adminName: params.adminName,
        module: params.module,
        action: params.action,
        details: params.details,
        requestIp: params.requestIp,
      },
    });
  }

  async getList(query: QueryOperationLogDto) {
    const {
      page = 1,
      pageSize = 10,
      adminId,
      action,
      keyword,
      startDate,
      endDate,
    } = query;

    const where: Prisma.AdminOperationLogWhereInput = {};

    // Filter by adminIdx
    if (adminId) {
      where.adminId = adminId;
    }

    // Filter by action (operationType)
    if (action && action !== 'ALL') {
      const normalizedAction = action.trim();
      const loweredAction = normalizedAction.toLowerCase();

      where.action = GENERIC_ACTION_FILTERS.has(loweredAction)
        ? { contains: loweredAction, mode: 'insensitive' }
        : { equals: normalizedAction, mode: 'insensitive' };
    }

    // Filter by keyword (search in adminName, details, module)
    if (keyword) {
      const trimmedKeyword = keyword.trim();
      where.OR = [
        { adminName: { contains: trimmedKeyword, mode: 'insensitive' } },
        { details: { contains: trimmedKeyword, mode: 'insensitive' } },
        { module: { contains: trimmedKeyword, mode: 'insensitive' } },
        { action: { contains: trimmedKeyword, mode: 'insensitive' } },
      ];
    }

    // Filter by date range
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = TimeHelper.getStartOfDay(startDate);
      }
      if (endDate) {
        where.createdAt.lte = TimeHelper.getEndOfDay(endDate);
      }
    }

    const [list, total] = await Promise.all([
      this.prisma.adminOperationLog.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          admin: {
            select: {
              id: true,
              username: true,
              realName: true,
            },
          },
        },
      }),
      this.prisma.adminOperationLog.count({ where }),
    ]);

    return {
      list,
      total,
      page,
      pageSize,
    };
  }
}
