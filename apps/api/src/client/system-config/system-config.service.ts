import { Injectable } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';

@Injectable()
export class ClientSystemConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async getAll() {
    const configs = await this.prisma.systemConfig.findMany({
      orderBy: { key: 'asc' },
    });

    return { list: configs };
  }
}
