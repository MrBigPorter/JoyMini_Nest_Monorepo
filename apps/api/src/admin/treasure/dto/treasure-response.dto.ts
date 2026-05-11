import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import {
  DateToTimestamp,
  DecimalToNumber,
  DecimalToString,
} from '@api/common/dto/transforms';

//  定义简化的分类信息
@Exclude()
export class TreasureCategoryResponseDto {
  @ApiProperty({ description: '分类ID' })
  @Expose()
  id!: number;

  @ApiProperty({ description: '分类名称' })
  @Expose()
  name!: string;
}

//  定义商品主体返回信息
@Exclude()
export class AdminTreasureResponseDto {
  // ==========================
  // 1. 基础信息
  // ==========================
  @ApiProperty({ description: '产品ID' })
  @Expose()
  treasureId!: string;

  @ApiProperty({ description: '产品名称' })
  @Expose()
  treasureName!: string;

  @ApiProperty({ description: '实物名称' })
  @Expose()
  productName?: string;

  // 统一：Decimal -> String(2位)（永不炸）
  @ApiProperty({ description: '成本价', example: '200.00' })
  @Expose()
  @DecimalToString(2, '0.00')
  costAmount!: string;

  //  统一：Decimal -> String(2位)（永不炸）
  @ApiProperty({ description: '单价', example: '100.00' })
  @Expose()
  @DecimalToString(2, '0.00')
  unitAmount!: string;

  @ApiProperty({
    description: '市场划线价',
    example: '299.00',
    required: false,
  })
  @Expose()
  @DecimalToString(2)
  marketAmount?: string;

  @ApiProperty({ description: '单买价', example: '129.00', required: false })
  @Expose()
  @DecimalToString(2)
  soloAmount?: string;

  @ApiProperty({ description: '总库存' })
  @Expose()
  seqShelvesQuantity!: number;

  @ApiProperty({ description: '已售数量' })
  @Expose()
  seqBuyQuantity!: number;

  /**
   * buyQuantityRate 在 Prisma 里是 Decimal(5,2) 可空：
   * - 你如果前端要 number，就用 DecimalToNumber
   * - 如果前端要字符串显示，就用 DecimalToString
   *
   * 我这里按你 swagger 写的 example: 50.5 => number
   */
  @ApiProperty({ description: '购买进度(%)', example: 50.5 })
  @Expose()
  @DecimalToNumber(0)
  buyQuantityRate!: number;

  @ApiProperty({ description: '封面图' })
  @Expose()
  treasureCoverImg?: string;

  @ApiProperty({ description: 'Blurhash placeholder', required: false })
  @Expose()
  blurhash?: string;

  @ApiProperty({ description: '状态: 0-下架 1-上架' })
  @Expose()
  state!: number;

  // ==========================
  // 2. 物流与拼团配置
  // ==========================
  @ApiProperty({ description: '物流类型: 1-实物 2-无需物流', example: 1 })
  @Expose()
  shippingType?: number;

  /**
   * weight 在 Prisma 里是 Decimal(10,3) 可空
   * 你现在写的 (value ? Number(value) : 0) 会把 0 当成 false -> 0（还好）
   * 但 value 可能是 Prisma.Decimal 对象，Number(decimalObj) 有时是 NaN（取决于实现）
   *  建议统一走 DecimalToNumber
   */
  @ApiProperty({ description: '重量(kg)', example: 0.5 })
  @Expose()
  @DecimalToNumber(0)
  weight?: number;

  @ApiProperty({ description: '成团人数', example: 5 })
  @Expose()
  groupSize?: number;

  @ApiProperty({ description: '成团时效(秒)', example: 86400 })
  @Expose()
  groupTimeLimit?: number;

  @ApiProperty({ description: '赠品配置JSON' })
  @Expose()
  bonusConfig?: any; // 直接透传 JSON

  // ==========================
  // 3. 预售时间
  // ==========================
  @ApiProperty({ description: '销售开始时间戳', example: 1709628000000 })
  @Expose()
  @DateToTimestamp()
  salesStartAt?: number;

  @ApiProperty({ description: '销售结束时间戳', example: 1709628000000 })
  @Expose()
  @DateToTimestamp()
  salesEndAt?: number;

  @ApiProperty({ description: '是否开启机器人补位', example: true })
  @Expose()
  enableRobot?: boolean;

  // ==========================
  // 4. 系统时间
  // ==========================
  @ApiProperty({ description: '创建时间', example: 1709628000000 })
  @Expose()
  @DateToTimestamp()
  createdAt!: number;

  @ApiProperty({ description: '更新时间', example: 1709628000000 })
  @Expose()
  @DateToTimestamp()
  updatedAt!: number;

  @ApiProperty({ description: '状态标签', example: 'ACTIVE' })
  @Expose()
  statusTag!: string;

  @ApiProperty({ description: '描述' })
  @Expose()
  desc?: string;

  @ApiProperty({ description: '规则内容' })
  @Expose()
  ruleContent?: string;

  @ApiProperty({ type: [TreasureCategoryResponseDto], description: '所属分类' })
  @Expose()
  categories!: TreasureCategoryResponseDto[];
}
