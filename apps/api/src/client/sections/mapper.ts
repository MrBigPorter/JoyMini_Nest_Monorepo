type Row = any;

export function mapTreasure(row: Row) {
  const treasureId = String(row.treasure_id ?? row.id ?? '');

  const rateRaw =
    row.buy_quantity_rate ??
    (row.seq_shelves_quantity
      ? (Number(row.seq_buy_quantity ?? 0) * 100) /
        Number(row.seq_shelves_quantity)
      : 0);
  const buyRate = Number(Number(rateRaw || 0).toFixed(2));

  return {
    // --- 1. 基础信息 ---
    treasureId: treasureId,
    treasureName: row.treasure_name ?? row.name ?? '',
    buyQuantityRate: buyRate,

    // --- 2. 金额/数字类 ---
    costAmount: row.cost_amount ? String(row.cost_amount) : '0.00',
    unitAmount: Number(row.unit_amount ?? 1),
    maxUnitCoins: row.max_unit_coins ? String(row.max_unit_coins) : '0',
    maxUnitAmount: row.max_unit_amount ? String(row.max_unit_amount) : '0.00',
    charityAmount: row.charity_amount ? String(row.charity_amount) : '0.00',

    seqBuyQuantity: Number(row.seq_buy_quantity ?? 0),
    seqShelvesQuantity: Number(row.seq_shelves_quantity ?? 0),
    minBuyQuantity: Number(row.min_buy_quantity ?? 1),
    maxPerBuyQuantity: Number(row.max_per_buy_quantity ?? 0),

    // --- 3. [新增] 物流与拼团配置 ---
    shippingType: Number(row.shipping_type ?? 1), // 1-实物 2-无需物流
    weight: Number(row.weight ?? 0),
    groupSize: Number(row.group_size ?? 5),
    groupTimeLimit: Number(row.group_time_limit ?? 86400),

    state: Number(row.state ?? 1),
    // --- 4. [新增] 赠品配置 (JSON 处理) ---
    // 数据库存的是 JSONB，Prisma 通常会自动 parse，但为了保险做一次判断
    bonusConfig:
      typeof row.bonus_config === 'string'
        ? JSON.parse(row.bonus_config)
        : (row.bonus_config ?? null),

    // --- 5. 时间/日期类 (统一转为毫秒时间戳供前端使用) ---
    lotteryTime: row.lottery_time
      ? Math.floor(new Date(row.lottery_time).getTime() / 1000)
      : 0,
    // 预售时间处理
    salesStartAt: row.sales_start_at
      ? new Date(row.sales_start_at).getTime()
      : null,
    salesEndAt: row.sales_end_at ? new Date(row.sales_end_at).getTime() : null,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : 0,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : 0,

    // --- 6. 字符串/列表类 ---
    productName: row.product_name ?? '',
    treasureSeq: row.treasure_seq ?? '',
    treasureCoverImg: row.treasure_cover_img ?? '',
    blurhash: row.blurhash ?? '',
    mainImageList: Array.isArray(row.main_image_list)
      ? row.main_image_list
      : [],
    ruleContent: row.rule_content ?? '',
    desc: row.desc ?? '', // 这里就是存富文本 HTML 的地方

    // 其他状态
    imgStyleType: Number(row.img_style_type ?? 0),
    lotteryMode: Number(row.lottery_mode ?? 1),
    cashState: Number(row.cash_state ?? 1),
    hotScore3d: Number(row.hot_score_3d ?? 0),
  };
}
