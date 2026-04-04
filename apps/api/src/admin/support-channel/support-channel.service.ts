import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@api/common/prisma/prisma.service';
import {
  CreateSupportChannelDto,
  QuerySupportChannelsDto,
  ToggleSupportChannelDto,
  UpdateSupportChannelDto,
} from './dto/support-channel.dto';
import * as crypto from 'crypto';

@Injectable()
export class SupportChannelService {
  constructor(private readonly prisma: PrismaService) {}

  async list(dto: QuerySupportChannelsDto) {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;

    const where: Prisma.SupportChannelWhereInput = {
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
    };

    const [total, list] = await Promise.all([
      this.prisma.supportChannel.count({ where }),
      this.prisma.supportChannel.findMany({
        where,
        orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          botUser: {
            select: { id: true, nickname: true, avatar: true, isRobot: true },
          },
        },
      }),
    ]);

    return {
      list,
      total,
      page,
      pageSize,
    };
  }

  async create(dto: CreateSupportChannelDto) {
    const existing = await this.prisma.supportChannel.findUnique({
      where: { id: dto.id },
      select: { id: true },
    });
    if (existing)
      throw new BadRequestException(`Support channel ${dto.id} already exists`);

    // User.phone is varchar(20), keep bot placeholder short and unique.
    const suffix = `${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
    const phone = `sb:${suffix}`;
    const phoneMd5 = crypto.createHash('md5').update(phone).digest('hex');

    return this.prisma.$transaction(async (tx) => {
      const botUser = await tx.user.create({
        data: {
          nickname: dto.name,
          avatar: dto.avatar,
          phone,
          phoneMd5,
          isRobot: true,
          status: 1,
        },
        select: { id: true, nickname: true, avatar: true },
      });

      return tx.supportChannel.create({
        data: {
          id: dto.id,
          name: dto.name,
          description: dto.description,
          botUserId: botUser.id,
          isActive: true,
        },
        include: {
          botUser: {
            select: { id: true, nickname: true, avatar: true, isRobot: true },
          },
        },
      });
    });
  }

  async update(id: string, dto: UpdateSupportChannelDto) {
    const channel = await this.prisma.supportChannel.findUnique({
      where: { id },
      select: { id: true, botUserId: true },
    });
    if (!channel)
      throw new NotFoundException(`Support channel ${id} not found`);

    return this.prisma.$transaction(async (tx) => {
      if (dto.name !== undefined || dto.avatar !== undefined) {
        await tx.user.update({
          where: { id: channel.botUserId },
          data: {
            ...(dto.name !== undefined ? { nickname: dto.name } : {}),
            ...(dto.avatar !== undefined ? { avatar: dto.avatar } : {}),
          },
        });
      }

      return tx.supportChannel.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description }
            : {}),
        },
        include: {
          botUser: {
            select: { id: true, nickname: true, avatar: true, isRobot: true },
          },
        },
      });
    });
  }

  async toggle(id: string, dto: ToggleSupportChannelDto) {
    const existing = await this.prisma.supportChannel.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing)
      throw new NotFoundException(`Support channel ${id} not found`);

    return this.prisma.supportChannel.update({
      where: { id },
      data: { isActive: dto.isActive },
      include: {
        botUser: {
          select: { id: true, nickname: true, avatar: true, isRobot: true },
        },
      },
    });
  }
}
