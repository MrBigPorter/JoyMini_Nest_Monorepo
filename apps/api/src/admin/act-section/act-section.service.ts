import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { CreateActSectionDto } from '@api/admin/act-section/dto/create-act-section.dto';
import { UpdateActSectionDto } from '@api/admin/act-section/dto/update-act-section.dto';
import { BindSectionItemDto } from '@api/admin/act-section/dto/bind-section-item.dto';
import { ACT_SECTION_STATUS } from '@lucky/shared';
import { QueryActSectionDto } from '@api/admin/act-section/dto/query-act-section.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class ActSectionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 创建活动专区
   * @param dto
   * @returns {Promise<ActSection>}
   * @throws {BadRequestException}
   * @memberof ActSectionService
   *
   */
  async create(dto: CreateActSectionDto) {
    // check act section exists
    const exists = await this.prisma.actSection.findUnique({
      where: {
        key: dto.key,
      },
    });
    if (exists) {
      throw new BadRequestException(
        `Act section with key ${dto.key} already exists`,
      );
    }

    return this.prisma.actSection.create({
      data: {
        ...dto,
      },
    });
  }

  /**
   * 获取活动专区列表
   * @param dto
   */
  async findAll(dto: QueryActSectionDto) {
    const { page, pageSize, status, title } = dto;
    const skip = (page - 1) * pageSize;

    const whereCondition: Prisma.ActSectionWhereInput = {};

    if (title) {
      whereCondition.title = { contains: title, mode: 'insensitive' };
    }

    if (status !== undefined) {
      whereCondition.status = status;
    }

    const [list, total] = await this.prisma.$transaction([
      this.prisma.actSection.findMany({
        where: whereCondition,
        skip: skip,
        take: pageSize,
        orderBy: { sortOrder: 'asc' }, // 展台按顺序排
        include: {
          items: {
            take: 3,
            orderBy: { sortOrder: 'asc' },
            include: { treasure: true },
          },
        },
      }),
      this.prisma.actSection.count(),
    ]);

    return { list, total, page, pageSize };
  }

  /**
   * 获取活动专区详情
   * @param id
   */
  async findOne(id: string) {
    const section = await this.prisma.actSection.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            treasure: true,
          },
        },
      },
    });
    if (!section) throw new NotFoundException('Act section not found');

    return {
      ...section,
      items: section.items.map((item) => ({
        ...item.treasure,
        costAmount: item.treasure.costAmount
          ? Number(item.treasure.costAmount)
          : 0,
        unitAmount: item.treasure.unitAmount
          ? Number(item.treasure.unitAmount)
          : 0,
        createdAt: item.treasure.createdAt
          ? new Date(item.treasure.createdAt).getTime()
          : 0,
        updatedAt: item.treasure.updatedAt
          ? new Date(item.treasure.updatedAt).getTime()
          : 0,
      })),
    };
  }

  /**
   * 更新活动专区状态
   * @param id
   * @param dto
   */
  async update(id: string, dto: UpdateActSectionDto) {
    await this.findOne(id);
    return this.prisma.actSection.update({
      where: { id },
      data: dto,
    });
  }

  /**
   * 删除活动专区
   * @param id
   */
  async remove(id: string) {
    const section = await this.findOne(id);

    // check if section is enabled, cannot delete
    if (section.status === ACT_SECTION_STATUS.ENABLE) {
      throw new BadRequestException(
        'Act section is enabled, cannot delete, please disable it first',
      );
    }

    // 级联删除：Prisma Schema 如果配置了 onDelete: Cascade，
    // 删除 Section 会自动删除 SectionItems (关联记录)
    return this.prisma.actSection.delete({
      where: { id },
    });
  }

  /**
   * 绑定商品
   * @param sectionId
   * @param dto
   */
  async bindTreasures(sectionId: string, dto: BindSectionItemDto) {
    // check section exists
    await this.findOne(sectionId);

    return this.prisma.$transaction(async (tx) => {
      const promises = dto.treasureIds.map((treasureId, index) => {
        return tx.actSectionItem.upsert({
          where: {
            sectionId_treasureId: { sectionId, treasureId },
          },
          update: {},
          create: {
            sectionId,
            treasureId,
            sortOrder: index,
          },
        });
      });
      return Promise.all(promises);
    });
  }

  /**
   * 解绑商品
   * @param sectionId
   * @param treasureId
   */
  async unbindTreasure(sectionId: string, treasureId: string) {
    try {
      // 物理删除关联记录 (把商品从展台拿下来，不是删商品本身)
      await this.prisma.actSectionItem.delete({
        where: {
          sectionId_treasureId: { sectionId, treasureId },
        },
      });
    } catch (e: unknown) {
      if (
        typeof e === 'object' &&
        e !== null &&
        'code' in e &&
        (e as { code?: unknown }).code === 'P2025'
      ) {
        return;
      }
      throw e;
    }
  }
}
