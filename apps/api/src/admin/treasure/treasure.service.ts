import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { CreateTreasureDto } from '@api/admin/treasure/dto/create-treasure.dto';
import { TREASURE_STATE, TreasureFilterType } from '@lucky/shared';
import { Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { QueryTreasureDto } from '@api/admin/treasure/dto/query-treasure.dto';
import { UpdateTreasureDto } from '@api/admin/treasure/dto/update-treasure.dto';
import { RedisService } from '@api/common/redis/redis.service';
import { HOME_CACHE_KEYS } from '@api/common/constants/cache.constants';

@Injectable()
export class TreasureService {
  constructor(
    private prisma: PrismaService,
    public redisService: RedisService,
  ) {}

  /**
   * Create a new treasure
   * @param dto
   * @returns Promise<Treasure>
   */
  async create(dto: CreateTreasureDto) {
    const { categoryIds, ...rest } = dto;

    try {
      return await this.prisma.treasure.create({
        data: {
          // 1. 基础字段映射
          treasureName: rest.treasureName,
          treasureCoverImg: rest.treasureCoverImg,
          blurhash: rest.blurhash,
          desc: rest.desc,
          costAmount: rest.costAmount,
          unitAmount: rest.unitAmount,

          //  价格配置
          marketAmount: rest.marketAmount, // 划线价
          soloAmount: rest.soloAmount, // 单买价

          //  自动化配置
          enableRobot: rest.enableRobot ?? false, // 默认关
          robotDelay: rest.robotDelay ?? 300, // 默认300秒

          // 团长奖励
          leaderBonusType: rest.leaderBonusType ?? 0,

          // 2. 库存处理 (DTO的 stockQuantity -> DB的 seqShelvesQuantity)
          // 如果前端没传 stockQuantity，尝试取旧字段，或者默认为 0
          seqShelvesQuantity: rest.seqShelvesQuantity ?? 0,
          seqBuyQuantity: 0, // 初始已售为 0
          salesEndAt: rest.salesEndAt,
          salesStartAt: rest.salesStartAt,

          // 3. 状态
          state: TREASURE_STATE.ACTIVE,

          // 4. [新增] 物流与拼团配置
          shippingType: rest.shippingType ?? 1, // 默认实物配送
          weight: rest.weight,
          groupSize: rest.groupSize ?? 5,
          groupTimeLimit: rest.groupTimeLimit ?? 86400,

          // 5. [类型修复] 强制转换为 any 以解决 DTO Class 与 Prisma JSON 的冲突
          bonusConfig: (rest.bonusConfig ?? Prisma.JsonNull) as any,

          // 6. 关联分类
          categories: {
            create: categoryIds.map((id) => ({
              category: {
                connect: { id },
              },
            })),
          },
        },
        include: {
          categories: {
            include: {
              category: true,
            },
          },
        },
      });
    } catch (error: unknown) {
      // 捕获"分类不存在"的错误
      if (error instanceof PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          throw new Error('Category not found');
        }
      }
      throw error;
    }
  }

  /**
   * Find all treasures with pagination
   * @param dto
   * @returns Promise<{ list: Treasure[], page: number, pageSize: number, total: number }>
   */
  async findAll(dto: QueryTreasureDto) {
    const { page, pageSize, categoryId, filterType } = dto;
    const skip = (page - 1) * pageSize;
    const take = pageSize;

    // define where condition first
    const whereCondition: Prisma.TreasureWhereInput = {};
    if (categoryId) {
      whereCondition.categories = {
        some: {
          categoryId: categoryId,
        },
      };
    }

    if (dto.treasureName) {
      whereCondition.treasureName = {
        contains: dto.treasureName, //包含字符串
        mode: 'insensitive', // 忽略大小写
      };
    }

    const now = new Date();

    if (filterType === TreasureFilterType.NOT_EXPIRED) {
      whereCondition.AND = [
        {
          OR: [
            { salesEndAt: null }, // 没有设置结束时间(永久售卖)
            { salesEndAt: { gt: now } }, // 或者 还没有结束
          ],
        },
      ];
    }

    if (filterType === TreasureFilterType.PRE_SALE) {
      //只看预售：开始时间 > 现在
      whereCondition.salesStartAt = {
        gt: now,
      };
    }

    if (filterType === TreasureFilterType.ON_SALE) {
      //  只看正在卖：
      // (开始时间为空 OR 开始时间 <= 现在) AND (未过期)
      whereCondition.AND = [
        {
          OR: [
            { salesStartAt: { lte: now } }, // 或者 已经开始了
            { salesStartAt: null }, // 没有设置开始时间(立即开售)
          ],
        },
        {
          OR: [
            { salesEndAt: null }, // 没有设置结束时间(永久售卖)
            { salesEndAt: { gt: now } }, // 或者 还没有结束
          ],
        },
      ];
    }

    const orderBy: Prisma.TreasureOrderByWithRelationInput = {};
    if (filterType === TreasureFilterType.PRE_SALE) {
      orderBy.salesStartAt = 'asc';
    } else {
      orderBy.createdAt = 'desc';
    }

    const [list, total] = await this.prisma.$transaction([
      this.prisma.treasure.findMany({
        where: whereCondition,
        skip,
        take,
        orderBy,
        include: {
          categories: {
            include: {
              category: true,
            },
          },
        },
      }),
      this.prisma.treasure.count({ where: whereCondition }),
    ]);

    return {
      list: list.map((item) => ({
        ...item,
        statusTag:
          item.salesStartAt && item.salesStartAt > now ? 'PRE_SALE' : 'ACTIVE',
      })),
      page,
      pageSize,
      total,
    };
  }

  /**
   * Find one treasure by id
   * @param id
   * @returns Promise<Treasure>
   */
  async findOne(id: string) {
    const item = await this.prisma.treasure.findUnique({
      where: {
        treasureId: id,
      },
      include: {
        categories: {
          include: {
            category: true,
          },
        },
      },
    });
    if (!item) throw new NotFoundException(`Treasure with id ${id} not found`);
    return {
      ...item,
      statusTag:
        item.salesStartAt && item.salesStartAt > new Date()
          ? 'PRE_SALE'
          : 'ON_SALE',
    };
  }

  /**
   * Update a treasure by id
   * @param id
   * @param dto
   * @returns Promise<Treasure>
   */
  async update(id: string, dto: UpdateTreasureDto) {
    // check treasure exists
    await this.findOne(id);

    const { categoryIds, ...rest } = dto;

    return this.prisma.treasure.update({
      where: { treasureId: id },
      data: {
        // --- 基础字段 (只有传了才更新) ---
        ...(rest.treasureName && { treasureName: rest.treasureName }),
        ...(rest.treasureCoverImg && {
          treasureCoverImg: rest.treasureCoverImg,
        }),
        ...(rest.blurhash && { blurhash: rest.blurhash }),
        ...(rest.unitAmount && { unitAmount: rest.unitAmount }),
        ...(rest.desc && { desc: rest.desc }),
        ...(rest.costAmount && { costAmount: rest.costAmount }),
        ...(rest.ruleContent && { ruleContent: rest.ruleContent }),

        // 兼容旧字段传参
        seqShelvesQuantity: rest.seqShelvesQuantity,

        // --- [新增] 配置更新 (只有传了才更新) ---
        ...(rest.shippingType && { shippingType: rest.shippingType }),
        ...(rest.weight !== undefined && { weight: rest.weight }),
        ...(rest.groupSize && { groupSize: rest.groupSize }),
        ...(rest.groupTimeLimit && { groupTimeLimit: rest.groupTimeLimit }),

        ...(rest.salesStartAt !== undefined && {
          salesStartAt: rest.salesStartAt,
        }),
        ...(rest.salesEndAt !== undefined && { salesEndAt: rest.salesEndAt }),

        // [类型修复] 只有当 bonusConfig 存在时才更新，并强转 any
        ...(rest.bonusConfig && {
          bonusConfig: rest.bonusConfig as any,
        }),

        //  价格更新
        ...(rest.marketAmount !== undefined && {
          marketAmount: rest.marketAmount,
        }),
        ...(rest.soloAmount !== undefined && { soloAmount: rest.soloAmount }),

        // 自动化配置更新
        ...(rest.enableRobot !== undefined && {
          enableRobot: rest.enableRobot,
        }),
        ...(rest.robotDelay !== undefined && { robotDelay: rest.robotDelay }),

        // 团长奖励更新
        ...(rest.leaderBonusType !== undefined && {
          leaderBonusType: rest.leaderBonusType,
        }),

        // --- 分类关联更新 ---
        ...(categoryIds && {
          categories: {
            deleteMany: {}, // 1. 先清空旧关联
            create: categoryIds.map((id) => ({
              category: {
                connect: { id }, // 2. 再建立新关联
              },
            })),
          },
        }),
      },
      include: {
        categories: {
          include: {
            category: true,
          },
        },
      },
    });
  }

  /**
   * Update treasure state
   * @param id
   * @param state
   * @returns Promise<Treasure>
   */
  async updateState(id: string, state: number) {
    const treasure = await this.findOne(id);
    if (!treasure) {
      throw new BadRequestException('Treasure not found');
    }

    if (treasure.state === state) {
      return treasure;
    }

    return this.prisma.treasure.update({
      where: { treasureId: id },
      data: {
        state,
      },
    });
  }

  /**
   * Delete a treasure by id
   * @param id
   * @returns Promise<Treasure>
   */
  async remove(id: string) {
    const hasOrder = await this.prisma.order.findFirst({
      where: { treasureId: id },
    });

    if (hasOrder) {
      throw new BadRequestException(
        'this treasure has order, can not delete, please change the state to inactive',
      );
    }

    return this.prisma.treasure.delete({
      where: { treasureId: id },
    });
  }

  /**
   * Purge home page cache related to treasures
   */
  async purgeHomeCache() {
    const keys = await this.redisService.keys(
      HOME_CACHE_KEYS.HOME_SECTIONS_PATTERN,
    );
    if (keys.length > 0) await this.redisService.del(...keys);
  }
}
