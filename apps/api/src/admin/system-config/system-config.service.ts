import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { UpdateSystemConfigDto } from './dto/update-system-config.dto';
import { CreateSystemConfigDto } from './dto/create-system-config.dto';

@Injectable()
export class SystemConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async getAll() {
    const configs = await this.prisma.systemConfig.findMany({
      orderBy: { key: 'asc' },
    });
    return { list: configs };
  }

  async update(key: string, dto: UpdateSystemConfigDto) {
    const existing = await this.prisma.systemConfig.findUnique({
      where: { key },
    });
    if (!existing) throw new NotFoundException(`Config key "${key}" not found`);

    return this.prisma.systemConfig.update({
      where: { key },
      data: { value: dto.value },
    });
  }

  // 新增：创建配置
  async create(dto: CreateSystemConfigDto) {
    // 检查是否已存在
    const existing = await this.prisma.systemConfig.findUnique({
      where: { key: dto.key },
    });

    if (existing) {
      throw new ConflictException(`Config key "${dto.key}" already exists`);
    }

    return this.prisma.systemConfig.create({
      data: {
        key: dto.key,
        value: dto.value,
      },
    });
  }

  // 新增：删除配置
  async delete(key: string) {
    const existing = await this.prisma.systemConfig.findUnique({
      where: { key },
    });

    if (!existing) {
      throw new NotFoundException(`Config key "${key}" not found`);
    }

    return this.prisma.systemConfig.delete({
      where: { key },
    });
  }

  // 新增：客户端获取配置（可选：可以添加白名单过滤）
  async getAllForClient() {
    const configs = await this.prisma.systemConfig.findMany({
      orderBy: { key: 'asc' },
    });

    return { list: configs };
  }
}
