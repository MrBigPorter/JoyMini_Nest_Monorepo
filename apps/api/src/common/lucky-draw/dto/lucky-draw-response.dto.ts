import { FieldMeta } from '@lucky/shared';

/**
 * 抽奖票的中奖结果（嵌套在 LuckyDrawTicketDto 中）
 */
export class LuckyDrawTicketResultDto {
  @FieldMeta({ label: { zh: '结果 ID', en: 'Result ID' } })
  id!: string;

  @FieldMeta({ label: { zh: '抽奖时间', en: 'Drawn At' }, type: 'date' })
  createdAt!: number;

  @FieldMeta({
    label: { zh: '奖品类型', en: 'Prize Type' },
    enum: {
      1: { zh: '优惠券', en: 'Coupon' },
      2: { zh: '金币', en: 'Coins' },
      3: { zh: '现金', en: 'Cash' },
      4: { zh: '未中奖', en: 'No Win' },
    },
  })
  prizeType!: number;

  @FieldMeta({ label: { zh: '奖品名称', en: 'Prize Name' } })
  prizeName!: string;

  @FieldMeta({ label: { zh: '奖品价值', en: 'Prize Value' } })
  prizeValue!: number | null;

  @FieldMeta({ label: { zh: '奖品快照', en: 'Prize Snapshot' } })
  prizeSnapshot!: unknown;
}

/**
 * 抽奖票（listTickets 返回的单张票）
 */
export class LuckyDrawTicketDto {
  @FieldMeta({ label: { zh: '票 ID', en: 'Ticket ID' } })
  id!: string;

  @FieldMeta({ label: { zh: '活动 ID', en: 'Activity ID' } })
  activityId!: string;

  @FieldMeta({ label: { zh: '活动名称', en: 'Activity Name' } })
  activityTitle!: string | null;

  @FieldMeta({ label: { zh: '活动结束时间', en: 'Activity End' }, type: 'date' })
  activityEndAt!: number | null;

  @FieldMeta({ label: { zh: '关联订单', en: 'Order ID' } })
  orderId!: string | null;

  @FieldMeta({ label: { zh: '已使用', en: 'Used' } })
  used!: boolean;

  @FieldMeta({ label: { zh: '使用时间', en: 'Used At' }, type: 'date' })
  usedAt!: number | null;

  @FieldMeta({ label: { zh: '过期时间', en: 'Expires At' }, type: 'date' })
  expireAt!: number | null;

  @FieldMeta({ label: { zh: '创建时间', en: 'Created At' }, type: 'date' })
  createdAt!: number;

  @FieldMeta({
    label: { zh: '中奖结果', en: 'Draw Result' },
    dtoClass: LuckyDrawTicketResultDto,
  })
  result!: LuckyDrawTicketResultDto | null;
}

/**
 * 中奖记录项（listResults 返回的单条记录）
 */
export class LuckyDrawResultItemDto {
  @FieldMeta({ label: { zh: '结果 ID', en: 'Result ID' } })
  id!: string;

  @FieldMeta({ label: { zh: '抽奖时间', en: 'Drawn At' }, type: 'date' })
  createdAt!: number;

  @FieldMeta({ label: { zh: '关联订单', en: 'Order ID' } })
  orderId!: string;

  @FieldMeta({ label: { zh: '奖品 ID', en: 'Prize ID' } })
  prizeId!: string;

  @FieldMeta({ label: { zh: '奖品名称', en: 'Prize Name' } })
  prizeName!: string;

  @FieldMeta({
    label: { zh: '奖品类型', en: 'Prize Type' },
    enum: {
      1: { zh: '优惠券', en: 'Coupon' },
      2: { zh: '金币', en: 'Coins' },
      3: { zh: '现金', en: 'Cash' },
      4: { zh: '未中奖', en: 'No Win' },
    },
  })
  prizeType!: number;

  @FieldMeta({ label: { zh: '奖品价值', en: 'Prize Value' } })
  prizeValue!: number | null;

  @FieldMeta({ label: { zh: '奖品快照', en: 'Prize Snapshot' } })
  prizeSnapshot!: unknown;
}
