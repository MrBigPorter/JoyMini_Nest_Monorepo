import { Injectable } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { TreasureQueryDto } from '@api/client/treasure/dto/treasure-query.dto';
import { RedisService } from '@api/common/redis/redis.service';
import { GROUP_STATUS, TreasureFilterType } from '@lucky/shared';
import { Prisma } from '@prisma/client';

@Injectable()
export class TreasureService {
  constructor(
    private readonly prisma: PrismaService,
    public readonly redisService: RedisService,
  ) {}

  // 统一计算购买进度，返回 0~100，保留两位小数
  private calcProgressPercent(
    seqShelvesQuantity: number | null | undefined,
    seqBuyQuantity: number | null | undefined,
  ): number {
    const total = seqShelvesQuantity ?? 0;
    const bought = seqBuyQuantity ?? 0;

    if (total <= 0) return 0;

    // 保留两位小数，比如 37.52
    return Math.round((bought * 10000) / total) / 100;
  }

  // 商品列表
  async list(query: TreasureQueryDto) {
    const { page, pageSize, q, categoryId, state, filterType } = query;

    const now = new Date();

    const where: any = {};

    where.state = typeof state === 'number' ? state : 1;

    if (q?.trim()) {
      where.OR = [
        { treasureName: { contains: q, mode: 'insensitive' } },
        { productName: { contains: q, mode: 'insensitive' } },
      ];
    }

    // 按分类筛选
    if (categoryId) {
      where.categories = {
        some: {
          categoryId,
        },
      };
    }

    if (filterType === TreasureFilterType.PRE_SALE) {
      //只看预售：开始时间 > 现在
      where.salesStartAt = {
        gt: now,
      };
    }

    if (filterType === TreasureFilterType.ON_SALE) {
      //  只看正在卖：
      // (开始时间为空 OR 开始时间 <= 现在) AND (未过期)
      where.AND = [
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

    // 5. 排序优化
    // 如果是查预售，按“开始时间”升序排（最近开始的排前面）
    // 否则按创建时间倒序
    const orderBy: Prisma.TreasureOrderByWithRelationInput = {};
    if (filterType === TreasureFilterType.PRE_SALE) {
      orderBy.salesStartAt = 'asc';
    } else {
      orderBy.createdAt = 'desc';
    }
    const [total, items] = await this.prisma.$transaction([
      this.prisma.treasure.count({ where }),
      this.prisma.treasure.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          treasureId: true,
          treasureSeq: true,
          treasureName: true,
          productName: true,
          treasureCoverImg: true,
          unitAmount: true,
          marketAmount: true, // 划线价
          soloAmount: true, // 单买价
          seqShelvesQuantity: true,
          seqBuyQuantity: true,
          lotteryMode: true,
          lotteryTime: true,
          state: true,
          cashState: true,
          charityAmount: true,
          groupMaxNum: true,
          imgStyleType: true,
          minBuyQuantity: true,
          maxUnitCoins: true,
          maxUnitAmount: true,
          maxPerBuyQuantity: true,
          groupSize: true,
          salesStartAt: true,
          salesEndAt: true,

          categories: {
            select: {
              category: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const mapped = items.map((it) => ({
      ...it,
      buyQuantityRate: this.calcProgressPercent(
        it.seqShelvesQuantity,
        it.seqBuyQuantity,
      ),
      categories: it.categories.map((c) => c.category),
      // 虽然前端可以算，但后端给标记更稳
      statusTag:
        it.salesStartAt && it.salesStartAt > now ? 'PRE_SALE' : 'ON_SALE',
    }));

    return {
      page,
      pageSize,
      total,
      list: mapped,
    };
  }

  // 详情
  async detail(id: string) {
    const result = await this.prisma.treasure.findUnique({
      where: { treasureId: id },
      select: {
        treasureId: true,
        treasureSeq: true,
        treasureName: true,
        productName: true,
        treasureCoverImg: true,
        unitAmount: true,
        marketAmount: true, // 划线价
        soloAmount: true, // 单买价
        enableRobot: true, // 机器人开关 (前端可能不需要，但查出来备用无妨)
        leaderBonusType: true, // 团长奖励类型 (前端可用于展示 "团长免单" 标签)
        seqShelvesQuantity: true,
        seqBuyQuantity: true,
        lotteryMode: true,
        lotteryTime: true,
        state: true,
        cashState: true,
        charityAmount: true,
        groupMaxNum: true,
        imgStyleType: true,
        ruleContent: true,
        costAmount: true,
        mainImageList: true,
        desc: true,
        minBuyQuantity: true,
        maxUnitCoins: true,
        maxUnitAmount: true,
        maxPerBuyQuantity: true,

        shippingType: true,
        groupSize: true,
        salesStartAt: true,
        salesEndAt: true,
        bonusConfig: true,
      },
    });

    if (!result) {
      throw new Error('Treasure not found');
    }

    const now = new Date(); // 获取当前时间

    const progressPercent = this.calcProgressPercent(
      result.seqShelvesQuantity,
      result.seqBuyQuantity,
    );

    return {
      ...result,
      buyQuantityRate: progressPercent,
      statusTag:
        result.salesStartAt && result.salesStartAt > now
          ? 'PRE_SALE'
          : 'ON_SALE',
    };
  }

  /**
   * 获取商品的最新状态（库存、价格、上下架、过期等）
   * @param id
   */
  async getStatus(id: string) {
    const result = await this.prisma.treasure.findUnique({
      where: { treasureId: id },
      select: {
        treasureId: true,
        state: true, // 上下架状态
        seqShelvesQuantity: true, // 总库存
        seqBuyQuantity: true, // 已买数量 (用于计算剩余库存)
        unitAmount: true, // 价格 (防止价格变动)
        soloAmount: true,
        salesEndAt: true, // 检查是否过期
        groupSize: true, // 拼团人数状态
      },
    });

    if (!result) {
      throw new Error('Treasure not found');
    }

    // 实时计算最新的进度/库存
    const stockLeft = (result?.seqShelvesQuantity ?? 0) - result.seqBuyQuantity;
    const isSoldOut = stockLeft <= 0;
    return {
      id: result.treasureId,
      stock: Math.max(1, stockLeft), // 剩余库存
      price: result.unitAmount,
      seqBuyQuantity: result.seqBuyQuantity, // 返回最新的已买数量
      isSoldOut: isSoldOut, // 直接告诉前端是否卖完
      soloPrice: result.soloAmount, // 返回单买价，前端可以再次校验
      state: result.state, // 1=上架, 0=下架
      isExpired: result.salesEndAt && new Date() > result.salesEndAt,
    };
  }

  /**
   *  获取热门拼团列表 (独立接口专用)
   * 逻辑：正在热卖 + 还没卖完 + 进度最快(或者剩余库存最少)
   * 缓存：建议在 Controller 层做 5秒 短缓存
   */

  async getHotGroups(limit = 10, userId?: string) {
    // 使用 SQL Raw 查询以获得最佳性能和复杂的排序逻辑
    const items = await this.prisma.$queryRawUnsafe<any[]>(
      `
      SELECT 
        t.treasure_id,
        t.treasure_name,
        t.product_name,
        t.treasure_cover_img,
        t.unit_amount,         -- 价格
        t.market_amount,       -- 原价
        t.seq_shelves_quantity,-- 总库存
        t.seq_buy_quantity,    -- 已买
        
        -- 计算进度 (0-100)
        ROUND((t.seq_buy_quantity::numeric / NULLIF(t.seq_shelves_quantity, 0)::numeric) * 100, 2) as progress_percent,

        -- 拿最近参与的3个用户头像 (如果有 user_treasure_participations 表关联的话，没有的话前端用假数据)
        -- 这里假设不需要关联，只查商品表
        
        t.group_size,
        t.sales_end_at
      FROM treasures t
      WHERE 
        t.state = 1 -- 上架中
        -- 必须是正在开售的 (排除预售)
        AND (t.sales_start_at IS NULL OR t.sales_start_at <= NOW()) 
        -- 必须是没过期的
        AND (t.sales_end_at IS NULL OR t.sales_end_at > NOW())
        -- 必须是还有库存的 (没卖完)
        AND (t.seq_shelves_quantity - t.seq_buy_quantity) > 0
      ORDER BY 
        -- 第一优先级：进度条越高越好 (营造疯抢感)
        (t.seq_buy_quantity::numeric / NULLIF(t.seq_shelves_quantity, 0)::numeric) DESC,
        -- 第二优先级：热度分 (如果有的话)
        t.hot_score_3d DESC,
        -- 第三优先级：最新创建
        t.created_at DESC
      LIMIT $1
    `,
      limit,
    );

    if (items.length === 0) return [];

    const userGroupsMap = new Map<string, string>(); // treasureId -> groupId
    const treasureIds = items.map((i) => i.treasure_id);

    // 并发执行：查当前用户的参与状态 + 查这些商品的最近参与头像
    const [userParticipations, recentAvatars] = await Promise.all([
      // A. 查当前登录用户状态 (修正 status -> groupStatus)
      userId
        ? this.prisma.treasureGroupMember.findMany({
            where: {
              userId: userId,
              group: {
                treasureId: { in: treasureIds },
                groupStatus: GROUP_STATUS.ACTIVE,
              },
            },
            select: {
              groupId: true,
              group: { select: { treasureId: true } },
            },
          })
        : Promise.resolve([]),

      this.prisma.treasureGroupMember.findMany({
        where: { group: { treasureId: { in: treasureIds } } },
        take: 50, // 拿最近的 50 条在内存里分发，避免循环查库
        orderBy: { joinedAt: 'desc' },
        select: {
          group: { select: { treasureId: true } },
          user: { select: { avatar: true } },
        },
      }),
    ]);

    // 建立用户参与映射
    userParticipations.forEach((p) => {
      userGroupsMap.set(p.group.treasureId, p.groupId);
    });

    return items.map((item) => {
      const myGroupId = userGroupsMap.get(item.treasure_id);

      // 提取该商品的最近头像
      const avatars = recentAvatars
        .filter((a) => a.group.treasureId === item.treasure_id)
        .map((a) => a.user.avatar)
        .filter((v) => !!v)
        .slice(0, 3) as string[];

      return {
        treasureId: item.treasure_id,
        treasureName: item.treasure_name,
        treasureCoverImg: item.treasure_cover_img,
        unitAmount: item.unit_amount,
        marketAmount: item.market_amount,
        buyQuantityRate: Number(item.progress_percent) / 100,
        stockLeft: item.seq_shelves_quantity - item.seq_buy_quantity,
        joinCount: item.seq_buy_quantity,
        recentJoinAvatars: avatars,
        isJoined: !!myGroupId,
        groupId: myGroupId || null,
      };
    });
  }
}
