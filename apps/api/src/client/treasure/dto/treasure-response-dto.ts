import { ApiProperty } from '@nestjs/swagger';
import {
  DateToTimestamp,
  DecimalToString,
  ToNumber,
} from '@api/common/dto/transforms';
import { PaginatedResponseDto } from '@api/common/dto/paginated-response.dto';

export class CategoryItemDto {
  @ApiProperty({ example: 'uuid-123' })
  id!: string;

  @ApiProperty({ example: 'Electronic' })
  name!: string;
}

export class TreasureResponseDto {
  @ApiProperty()
  treasureId!: string;

  @ApiProperty()
  treasureSeq!: string;

  @ApiProperty()
  treasureName!: string;

  @ApiProperty()
  productName!: string;

  @ApiProperty()
  treasureCoverImg!: string;

  @ApiProperty({ description: 'Blurhash placeholder', required: false })
  blurhash?: string;

  @ApiProperty({ description: '单次参与金额 (拼团价)' })
  @DecimalToString()
  unitAmount!: number;

  @ApiProperty({ description: '市场划线价 (展示用)', required: false })
  @DecimalToString()
  marketAmount?: number;

  @ApiProperty({ description: '单独购买价', required: false })
  @DecimalToString()
  soloAmount?: number;

  @ApiProperty({ description: '是否开启机器人补位', required: false })
  enableRobot?: boolean;

  @ApiProperty({
    description: '团长奖励类型: 0-无 1-免单 2-佣金',
    required: false,
  })
  leaderBonusType?: number;

  @ApiProperty({ description: '购买进度 0~100' })
  buyQuantityRate!: number;

  @ApiProperty()
  state!: number;

  @ApiProperty({ required: false })
  @DateToTimestamp()
  lotteryTime?: number;

  // --- 拼团与预售相关 ---
  @ApiProperty({ description: '1-实物, 2-虚拟券' })
  shippingType!: number;

  @ApiProperty({ description: '成团人数' })
  groupSize!: number;

  @ApiProperty({ description: '开售时间戳(ms)', required: false })
  @DateToTimestamp()
  salesStartAt?: number;

  @ApiProperty({ description: '截止时间戳(ms)', required: false })
  @DateToTimestamp()
  salesEndAt?: number;

  // --- 详情特有字段 ---
  @ApiProperty({ required: false })
  @DecimalToString()
  costAmount?: string;

  @ApiProperty({ type: [String], required: false })
  mainImageList?: string[];

  @ApiProperty({ description: '富文本描述', required: false })
  desc?: string;

  @ApiProperty({ type: [CategoryItemDto], required: false })
  categories?: CategoryItemDto[];

  @ApiProperty({ description: '奖金配置', required: false })
  bonusConfig: any;
}

export class TreasureListResponseDto extends PaginatedResponseDto<TreasureResponseDto> {
  @ApiProperty({ type: [TreasureResponseDto] })
  override list!: TreasureResponseDto[];
}

export class TreasureStatusDto {
  @ApiProperty({ description: '产品ID' })
  id!: string;

  @ApiProperty({ description: '剩余库存' })
  stock!: number;

  @ApiProperty({ description: '已拼团数量' })
  @ToNumber()
  seqBuyQuantity!: number;

  @ApiProperty({ description: '拼团价格' })
  @DecimalToString()
  price!: string;

  @ApiProperty({ description: '单独购买价', required: false })
  @DecimalToString()
  soloPrice?: string;

  @ApiProperty({ description: '是否售罄' })
  isSoldOut!: boolean;

  @ApiProperty({ description: '上下架状态' })
  state!: number;

  @ApiProperty({ description: '是否过期' })
  isExpired!: boolean;
}
