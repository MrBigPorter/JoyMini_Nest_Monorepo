import { ApiProperty } from '@nestjs/swagger';
import { DateToTimestamp, DecimalToString } from '@api/common/dto/transforms';
import { Exclude, Expose } from 'class-transformer';
import { FieldMeta } from '@lucky/shared';

@Exclude()
export class HotGroupItemDto {
  @FieldMeta({ label: { en: 'Product ID' } })
  @ApiProperty({
    description: '商品ID',
    example: 'cmjy1c9a50001q9bad9ew8tzk',
  })
  @Expose()
  treasureId!: string;

  @FieldMeta({ label: { en: 'Product Name' } })
  @ApiProperty({
    description: '商品名称',
    example: 'iPhone 15 Pro Max 256G',
  })
  @Expose()
  treasureName!: string;

  @FieldMeta({ label: { en: 'Cover Image' } })
  @ApiProperty({
    description: '封面图片 URL',
    example: 'https://example.com/image.png',
  })
  @Expose()
  treasureCoverImg!: string;

  @FieldMeta({ label: { en: 'Price' }, type: 'amount' })
  @ApiProperty({
    description: '当前售价 (单买或拼团价)',
    example: 9.9,
  })
  @DecimalToString()
  @Expose()
  unitAmount!: string;

  @FieldMeta({ label: { en: 'Market Price' }, type: 'amount' })
  @ApiProperty({
    description: '市场价 (划线价)',
    required: false,
    example: 99.0,
  })
  @DecimalToString()
  @Expose()
  marketAmount?: number;

  @FieldMeta({ label: { en: 'Progress' } })
  @ApiProperty({
    description: '销售进度/热度值 (范围 0.0 ~ 1.0)',
    example: 0.85,
  })
  @Expose()
  buyQuantityRate!: number;

  @FieldMeta({ label: { en: 'Stock Left' } })
  @ApiProperty({
    description: '剩余库存数量 (用于显示"仅剩X件")',
    example: 12,
  })
  @Expose()
  stockLeft!: number;

  @FieldMeta({ label: { en: 'Buyers' } })
  @ApiProperty({
    description: '已参与人数 (用于显示"100+人参与")',
    example: 128,
  })
  @Expose()
  joinCount!: number;

  @FieldMeta({ label: { en: 'Recent Buyers' } })
  @ApiProperty({
    description: '最近参与用户的头像列表 (用于头像堆叠显示)',
    type: [String],
    required: false,
    example: [
      'https://i.pravatar.cc/150?img=1',
      'https://i.pravatar.cc/150?img=2',
    ],
  })
  @Expose()
  recentJoinAvatars!: string[];

  @FieldMeta({ label: { en: 'Sale End' }, type: 'date' })
  @ApiProperty({
    description: '销售结束时间 (用于显示倒计时)',
    required: false,
  })
  @DateToTimestamp()
  @Expose()
  salesEndAt?: number;

  @FieldMeta({ label: { en: 'Joined' } })
  @ApiProperty({
    description: '当前用户是否已参与',
    example: true,
  })
  @Expose()
  isJoined!: boolean;

  @FieldMeta({ label: { en: 'Group ID' } })
  @ApiProperty({
    description: '如果已参与，返回对应的 groupId；如果未参与，返回 null',
    example: 'cg1a2b3c4d5e6f7g8h9i0j',
  })
  @Expose()
  groupId!: string | null;
}
