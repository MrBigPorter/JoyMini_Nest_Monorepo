import { ApiProperty } from '@nestjs/swagger';
import {
  DateToTimestamp,
  DecimalToString,
  ToNumber,
} from '@api/common/dto/transforms';
import { PaginatedResponseDto } from '@api/common/dto/paginated-response.dto';
import { FieldMeta } from '@lucky/shared';

export class CategoryItemDto {
  @FieldMeta({ label: { en: 'Category ID' } })
  @ApiProperty({ example: 'uuid-123' })
  id!: string;

  @FieldMeta({ label: { en: 'Category Name' } })
  @ApiProperty({ example: 'Electronic' })
  name!: string;
}

export class TreasureResponseDto {
  @FieldMeta({ label: { en: 'Product ID' } })
  @ApiProperty()
  treasureId!: string;

  @FieldMeta({ label: { en: 'Product Seq' } })
  @ApiProperty()
  treasureSeq!: string;

  @FieldMeta({ label: { en: 'Product Name' } })
  @ApiProperty()
  treasureName!: string;

  @FieldMeta({ label: { en: 'Name' } })
  @ApiProperty()
  productName!: string;

  @FieldMeta({ label: { en: 'Cover Image' } })
  @ApiProperty()
  treasureCoverImg!: string;

  @FieldMeta({ label: { en: 'Blurhash' } })
  @ApiProperty({ description: 'Blurhash placeholder', required: false })
  blurhash?: string;

  @FieldMeta({ label: { en: 'Unit Price' }, type: 'amount' })
  @ApiProperty({ description: '单次参与金额 (拼团价)' })
  @DecimalToString()
  unitAmount!: number;

  @FieldMeta({ label: { en: 'Market Price' }, type: 'amount' })
  @ApiProperty({ description: '市场划线价 (展示用)', required: false })
  @DecimalToString()
  marketAmount?: number;

  @FieldMeta({ label: { en: 'Solo Price' }, type: 'amount' })
  @ApiProperty({ description: '单独购买价', required: false })
  @DecimalToString()
  soloAmount?: number;

  @FieldMeta({ label: { en: 'Robot Fill' } })
  @ApiProperty({ description: '是否开启机器人补位', required: false })
  enableRobot?: boolean;

  @FieldMeta({
    label: { en: 'Leader Bonus' },
    enum: {
      0: { en: 'None' },
      1: { en: 'Free Order' },
      2: { en: 'Commission' },
    },
  })
  @ApiProperty({
    description: '团长奖励类型: 0-无 1-免单 2-佣金',
    required: false,
  })
  leaderBonusType?: number;

  @FieldMeta({ label: { en: 'Progress' } })
  @ApiProperty({ description: '购买进度 0~100' })
  buyQuantityRate!: number;

  @FieldMeta({ label: { en: 'State' } })
  @ApiProperty()
  state!: number;

  @FieldMeta({ label: { en: 'Lottery Time' }, type: 'date' })
  @ApiProperty({ required: false })
  @DateToTimestamp()
  lotteryTime?: number;

  // --- 拼团与预售相关 ---
  @FieldMeta({
    label: { en: 'Shipping Type' },
    enum: {
      1: { en: 'Physical' },
      2: { en: 'Digital Voucher' },
    },
  })
  @ApiProperty({ description: '1-实物, 2-虚拟券' })
  shippingType!: number;

  @FieldMeta({ label: { en: 'Group Size' } })
  @ApiProperty({ description: '成团人数' })
  groupSize!: number;

  @FieldMeta({ label: { en: 'Sale Start' }, type: 'date' })
  @ApiProperty({ description: '开售时间戳(ms)', required: false })
  @DateToTimestamp()
  salesStartAt?: number;

  @FieldMeta({ label: { en: 'Sale End' }, type: 'date' })
  @ApiProperty({ description: '截止时间戳(ms)', required: false })
  @DateToTimestamp()
  salesEndAt?: number;

  // --- 详情特有字段 ---
  @FieldMeta({ label: { en: 'Cost' }, type: 'amount' })
  @ApiProperty({ required: false })
  @DecimalToString()
  costAmount?: string;

  @FieldMeta({ label: { en: 'Images' } })
  @ApiProperty({ type: [String], required: false })
  mainImageList?: string[];

  @FieldMeta({ label: { en: 'Description' } })
  @ApiProperty({ description: '富文本描述', required: false })
  desc?: string;

  @FieldMeta({ label: { en: 'Categories' }, dtoClass: CategoryItemDto })
  @ApiProperty({ type: [CategoryItemDto], required: false })
  categories?: CategoryItemDto[];

  @FieldMeta({ label: { en: 'Bonus Config' } })
  @ApiProperty({ description: '奖金配置', required: false })
  bonusConfig: any;
}

export class TreasureListResponseDto extends PaginatedResponseDto<TreasureResponseDto> {
  @ApiProperty({ type: [TreasureResponseDto] })
  override list!: TreasureResponseDto[];
}

export class TreasureStatusDto {
  @FieldMeta({ label: { en: 'Product ID' } })
  @ApiProperty({ description: '产品ID' })
  id!: string;

  @FieldMeta({ label: { en: 'Stock' } })
  @ApiProperty({ description: '剩余库存' })
  stock!: number;

  @FieldMeta({ label: { en: 'Sold Quantity' } })
  @ApiProperty({ description: '已拼团数量' })
  @ToNumber()
  seqBuyQuantity!: number;

  @FieldMeta({ label: { en: 'Price' }, type: 'amount' })
  @ApiProperty({ description: '拼团价格' })
  @DecimalToString()
  price!: string;

  @FieldMeta({ label: { en: 'Solo Price' }, type: 'amount' })
  @ApiProperty({ description: '单独购买价', required: false })
  @DecimalToString()
  soloPrice?: string;

  @FieldMeta({ label: { en: 'Sold Out' } })
  @ApiProperty({ description: '是否售罄' })
  isSoldOut!: boolean;

  @FieldMeta({ label: { en: 'State' } })
  @ApiProperty({ description: '上下架状态' })
  state!: number;

  @FieldMeta({ label: { en: 'Expired' } })
  @ApiProperty({ description: '是否过期' })
  isExpired!: boolean;
}
