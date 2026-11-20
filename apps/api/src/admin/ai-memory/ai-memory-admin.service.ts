import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { AiMemoryService } from '@api/common/ai/ai-memory.service';
import { OperationLogService } from '../operation-log/operation-log.service';

@Injectable()
export class AiMemoryAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly memory: AiMemoryService,
    private readonly operationLog: OperationLogService,
  ) {}

  async getUserMemories(userId: string) {
    const [memories, summaries] = await Promise.all([
      this.prisma.aiUserMemory.findMany({
        where: { userId },
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        take: 500,
      }),
      this.prisma.aiMemorySummary.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        take: 100,
      }),
    ]);
    return { userId, memories, summaries };
  }

  async deleteMemory(id: string, adminId: string) {
    const memory = await this.prisma.aiUserMemory.findUnique({ where: { id } });
    if (!memory) throw new NotFoundException('Memory not found');

    const updated = await this.prisma.aiUserMemory.update({
      where: { id },
      data: { status: 'DELETED' },
    });
    await this.operationLog.log({
      adminId,
      adminName: adminId,
      module: 'ai-memory',
      action: 'delete',
      details: `soft delete memory ${id} for user ${memory.userId}`,
    });
    return updated;
  }

  async deleteUserMemories(userId: string, adminId: string) {
    const result = await this.memory.deleteUserMemories(userId);
    await this.operationLog.log({
      adminId,
      adminName: adminId,
      module: 'ai-memory',
      action: 'delete-all',
      details: `delete memories=${result.memories}, summaries=${result.summaries} for user ${userId}`,
    });
    return result;
  }
}
