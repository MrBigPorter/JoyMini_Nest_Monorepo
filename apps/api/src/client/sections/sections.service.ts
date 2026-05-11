import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { mapTreasure } from './mapper';
import { SectionKey } from '@lucky/shared';
import pLimit from 'p-limit';
import { RedisService } from '@api/common/redis/redis.service';
import { RedisLockService } from '@api/common/redis/redis-lock.service';
import { DistributedLock } from '@api/common/decorators/distributed-lock.decorator';
import { HOME_CACHE_KEYS } from '@api/common/constants/cache.constants';

type SectionRow = {
  id: string;
  key: string;
  title: string;
  imgStyleType: number | string | null;
  limit: number | string | null;
};

type TreasureRow = Record<string, any>;

export type HomeSectionResponse = {
  actId: string;
  key: string;
  title: string;
  imgStyleType: number;
  treasureResp: ReturnType<typeof mapTreasure>[];
};

const TREASURE_SELECT = `
  t.treasure_id,
  t.treasure_name,
  t.buy_quantity_rate,
  t.seq_buy_quantity,
  t.seq_shelves_quantity,

  t.cost_amount,
  t.unit_amount,
  t.market_amount, 
  t.solo_amount,
  t.max_unit_coins,
  t.max_unit_amount,
  t.charity_amount,

  t.img_style_type,
  t.lottery_mode,
  t.lottery_time,
  t.min_buy_quantity,
  t.max_per_buy_quantity,
  t.cash_state,

  t.product_name,
  t.treasure_seq,
  t.treasure_cover_img,
  t.blurhash,
  t.main_image_list,
  t.rule_content,
  t."desc",
  t.state,

  t.shipping_type,
  t.weight,
  t.group_size,
  t.group_time_limit,

  t.bonus_config,
  t.group_size, 
  t.sales_start_at,
  t.sales_end_at,

  t.hot_score_3d,
  t.created_at,
  t.updated_at
`;

@Injectable()
export class SectionsService implements OnModuleInit {
  private readonly logger = new Logger(SectionsService.name);
  private readonly limitRunner = pLimit(4);
  private handlers!: Record<
    SectionKey,
    (s: SectionRow, take: number) => Promise<TreasureRow[]>
  >;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    public readonly lockService: RedisLockService,
  ) {}

  onModuleInit() {
    // 将 Handler 初始化移出主方法，减少内存开销
    this.handlers = {
      [SectionKey.SPECIAL]: (s, take) => this.fetchManualItems(s.id, take),
      [SectionKey.NEW_USER]: (s, take) => this.fetchManualItems(s.id, take),
      [SectionKey.APPLE]: (s, take) => this.fetchManualItems(s.id, take),
      [SectionKey.ENDING]: (s, take) => this.fetchEndingItems(take),
      [SectionKey.FEATURED]: (s, take) => this.fetchFeaturedItems(take),
      [SectionKey.RECOMMEND]: (s, take) => this.fetchRecommendItems(take),
    };
  }

  private homeKey(limit: number) {
    return HOME_CACHE_KEYS.HOME_SECTIONS(limit);
  }

  /**  * 获取首页楼层数据（带缓存）
   * @param limit
   */
  async getHomeSections(limit = 8) {
    const takeLimit = Math.max(1, limit);
    const key = this.homeKey(takeLimit);

    // 1. 先查缓存,看菜单
    const cache = await this.redisService.get(key);
    if (cache) {
      try {
        return JSON.parse(cache) as HomeSectionResponse[];
      } catch (e) {
        // 缓存脏数据，删掉重建
        await this.redisService.del(key);
      }
    }

    // 2. 缓存不存在或解析失败，查数据库
    const sections = await this.getHomeSectionsNoCache(takeLimit);

    try {
      // 3) 写回菜单牌（TTL 60s，可按需要调 30/120）
      //在设置缓存时增加一个随机偏移量，防止在流量高峰期大量缓存同时失效
      const ttl = 60 + Math.floor(Math.random() * 10); // 60-70秒随机
      await this.redisService.set(key, JSON.stringify(sections), ttl);
    } catch (e) {
      this.logger.error(`Failed to set cache for key ${key}: ${e}`);
    }
    return sections;
  }

  /**  * 获取首页楼层数据（带缓存）,加分布式锁防止缓存击穿
   * @param limit
   * @param limit
   * @private
   */
  @DistributedLock(HOME_CACHE_KEYS.LOCK_HOME_SECTIONS_TPL, 10000)
  private async getHomeSectionsNoCache(limit = 8) {
    // 二次确认缓存
    const key = this.homeKey(limit);
    const cache = await this.redisService.get(key);
    if (cache) {
      return JSON.parse(cache) as HomeSectionResponse[];
    }
    // 1. 查出所有启用的楼层
    const sections = (await this.prisma.actSection.findMany({
      where: { status: 1 },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        key: true,
        title: true,
        imgStyleType: true,
        limit: true,
      },
    })) as SectionRow[];

    if (sections.length === 0) {
      return [];
    }

    const allSections = await Promise.all(
      sections.map(async (s) =>
        this.limitRunner(async () => {
          const takeRaw = Number(s.limit ?? limit);
          const take = Math.min(
            50,
            Math.max(
              1,
              Number.isFinite(takeRaw) && takeRaw > 0 ? takeRaw : limit,
            ),
          );
          const handler =
            this.handlers[s.key as SectionKey] ??
            ((s, take) => this.fetchRecommendItems(take));

          let rows: TreasureRow[] = [];
          try {
            rows = await handler(s, take);
          } catch (error: any) {
            // 单个楼层失败不要拖死整个首页，记录日志并返回空
            this.logger.error(
              `getHomeSections failed: key=${s.key} sectionId=${s.id} ${error?.message ?? error}`,
            );
            rows = [];
          }
          return {
            actId: s.id,
            key: s.key,
            title: s.title,
            imgStyleType: Number(s.imgStyleType ?? 0),
            treasureResp: rows.map(mapTreasure),
          } as HomeSectionResponse;
        }),
      ),
    );

    // 过滤掉没有商品的楼层
    return allSections.filter((section) => section.treasureResp.length > 0);
  }

  /**
   * 逻辑 A: 手动关联 (查 act_section_items 表)
   * 适用于：苹果专区、新人专区、运营活动位
   */
  private async fetchManualItems(sectionId: string, limit: number) {
    // 1. 先查关联表拿到 treasure_id
    const binds = await this.prisma.actSectionItem.findMany({
      where: { sectionId },
      orderBy: { sortOrder: 'asc' },
      take: limit,
      select: { treasureId: true }, // 只取ID即可
    });

    if (binds.length === 0) return [];

    const ids = binds.map((b) => b.treasureId);

    // 2. 按顺序查产品
    // 注意：这里用了 array_position 保证返回顺序和后台拖拽排序一致
    return this.prisma.$queryRawUnsafe<any[]>(
      `
        SELECT ${TREASURE_SELECT}
        FROM treasures t
        WHERE t.state = 1
          AND t.treasure_id = ANY($1::text[])
        --  新增：过滤掉过期的商品 
         AND (t.sales_end_at IS NULL OR t.sales_end_at > NOW())
        ORDER BY array_position($1::text[], t.treasure_id)
        LIMIT $2
      `,
      ids,
      limit,
    );
  }

  /**
   * 逻辑 B1: 即将开团/进度最快 (优先展示最紧迫的团购机会)
   * */
  private async fetchEndingItems(limit: number) {
    return this.prisma.$queryRawUnsafe<any[]>(
      `
        SELECT ${TREASURE_SELECT}
        FROM treasures t
        WHERE t.state = 1
        --  过滤过期
        AND (t.sales_end_at IS NULL OR t.sales_end_at > NOW())
        ORDER BY
          -- 1. 还没开始的排在最上方
          CASE WHEN t.sales_start_at > NOW() THEN 0 ELSE 1 END,
          -- 2. 还没开始的：按开始时间【升序】，最快开售的在最前
          CASE WHEN t.sales_start_at > NOW() THEN t.sales_start_at ELSE NULL END ASC NULLS LAST,
          -- 3. 已经开始的：按进度【降序】，快成团的在最前
          (t.seq_buy_quantity::numeric / NULLIF(t.seq_shelves_quantity, 0)::numeric) DESC NULLS LAST, -- 这里补上逗号
          -- 4. 最后按创建时间
          t.created_at DESC
        LIMIT $1
      `,
      limit,
    );
  }

  /**
   * 逻辑 B2: 最新上架 (考虑即将开始的预售)
   * */
  private async fetchFeaturedItems(limit: number) {
    return this.prisma.$queryRawUnsafe<any[]>(
      `
        SELECT ${TREASURE_SELECT}
        FROM treasures t
        WHERE t.state = 1
        AND (t.sales_end_at IS NULL OR t.sales_end_at > NOW())
        ORDER BY
        -- 让刚上架但还没开始团购的排在前面，作为预告
        CASE WHEN t.sales_start_at > NOW() THEN 0 ELSE 1 END,
        t.created_at DESC
        LIMIT $1
      `,
      limit,
    );
  }

  /**
   * 逻辑 B3: 热门推荐 (兜底)
   */
  private async fetchRecommendItems(limit: number) {
    return this.prisma.$queryRawUnsafe<any[]>(
      `
        SELECT ${TREASURE_SELECT}
        FROM treasures t
        WHERE t.state = 1
        AND (t.sales_end_at IS NULL OR t.sales_end_at > NOW())
        ORDER BY
            -- 优先展示 3日热度 (需要在 Seed 里或者定时任务里更新这个字段)
            t.hot_score_3d DESC, 
            -- 其次按进度条
            (t.seq_buy_quantity::numeric / NULLIF(t.seq_shelves_quantity, 0)::numeric) DESC NULLS LAST
        LIMIT $1
      `,
      limit,
    );
  }
}
