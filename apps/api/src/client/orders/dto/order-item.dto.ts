import { ApiProperty } from '@nestjs/swagger';
import { DateToTimestamp, DecimalToString } from '@api/common/dto/transforms';
import { Transform, Type } from 'class-transformer';
import Decimal from 'decimal.js';

const SafeDecimal = () =>
  Transform(({ key, value, obj }) => {
    // 1. 如果是空，打印警告并返回安全值
    if (value === null || value === undefined) {
      // 打开注释可以看所有字段的情况，但为了不刷屏，我们只在出错时关心
      // console.log(`[SafeDecimal] Field: ${key} is ${value}. Returning 0.00`);
      return '0.00';
    }

    try {
      return new Decimal(value).toFixed(2);
    } catch (e) {
      // 🔥🔥🔥 这里的日志是破案的关键！
      console.error(`[CRITICAL ERROR] Failed to transform field: "${key}"`);
      console.error(`Value received:`, value);
      console.error(`Parent Object:`, obj);
      return '0.00'; // 即使炸了也兜底，保证不红屏
    }
  });

class TreasureDTo {
  @ApiProperty({
    description: 'treasureName',
    example: 'Ancient Vase',
    type: String,
  })
  treasureName!: string;
  @ApiProperty({
    description: 'treasureCoverImg',
    example: 'https://example.com/ancient-vase.png',
    type: String,
  })
  treasureCoverImg!: string;
  @ApiProperty({
    description: 'Blurhash placeholder',
    required: false,
    example: 'LKO2?U%2Tw=w]~RBVZR}[4@?ngkB',
    type: String,
  })
  blurhash?: string;
  @ApiProperty({
    description: 'productName',
    example: 'Vase Product',
    type: String,
  })
  productName!: string;
  @ApiProperty({ description: 'isVirtual', example: 1, type: Number })
  virtual!: number;
  @ApiProperty({ description: 'cashAmount', example: '9.99', type: String })
  @DecimalToString()
  cashAmount!: string;
  @ApiProperty({ description: 'coinAmount', example: '100', type: String })
  cashState!: number;
  @ApiProperty({ description: 'seqBuyQuantity', example: 100, type: Number })
  seqBuyQuantity!: number;
  @ApiProperty({
    description: 'seqShelvesQuantity',
    example: 500,
    type: Number,
  })
  seqShelvesQuantity!: number;
}

class groupDto {
  @ApiProperty({ description: 'groupId', example: 'uuid-v4', type: String })
  groupId!: string;
  @ApiProperty({ description: 'currentMembers', example: 5, type: Number })
  currentMembers!: number;
  @ApiProperty({ description: 'maxMembers', example: 10, type: Number })
  maxMembers!: number;
  @ApiProperty({ description: 'groupStatus', example: 1, type: Number })
  groupStatus!: number;
}

export class WalletTransactionDto {
  @ApiProperty({
    description: 'Transaction ID',
    example: 'txnId123',
    type: String,
  })
  transactionNo!: string;
  @ApiProperty({ description: 'Amount', example: '50.00', type: String })
  @DecimalToString()
  amount!: string;
  @ApiProperty({
    description: 'balanceType 1-balance 2-coin',
    example: 1,
    type: Number,
  })
  balanceType!: number;
  @ApiProperty({ description: 'Status', example: 1, type: Number })
  status!: number;
  @ApiProperty({
    type: Number,
    description: 'createdAt',
    example: 1704067200000,
  })
  @DateToTimestamp()
  createdAt!: number;
}

export class OrderItemDto {
  @ApiProperty({ description: 'Order ID', example: 'orderId123', type: String })
  orderId!: string;

  @ApiProperty({
    description: 'Order No',
    example: '202406010001',
    type: String,
  })
  orderNo!: string;

  @ApiProperty({
    type: Number,
    description: 'createdAt',
    example: 1704067200000,
  })
  @DateToTimestamp()
  createdAt!: number;

  @ApiProperty({
    type: Number,
    description: 'updatedAt',
    example: 1704067200000,
  })
  @DateToTimestamp()
  updatedAt!: number;

  @ApiProperty({ description: 'buyQuantity', example: 2, type: Number })
  buyQuantity!: number;
  @ApiProperty({ description: 'treasureId', example: '1', type: String })
  treasureId!: string;
  @ApiProperty({ description: 'unitPrice', example: '9.99', type: String })
  @DecimalToString()
  unitPrice!: string;

  @ApiProperty({
    description: 'originalAmount',
    example: '19.98',
    type: String,
  })
  @DecimalToString()
  originalAmount!: string;
  @ApiProperty({ description: 'discountAmount', example: '2.00', type: String })
  @DecimalToString()
  discountAmount!: string;

  @ApiProperty({ description: 'couponAmount', example: '3.00', type: String })
  @DecimalToString()
  couponAmount!: string;
  @ApiProperty({ description: 'coinAmount', example: '5.00', type: String })
  @DecimalToString()
  coinAmount!: string;

  @ApiProperty({ description: 'finalAmount', example: '9.98', type: String })
  @DecimalToString()
  finalAmount!: string;

  @ApiProperty({ description: 'orderStatus', example: 1, type: Number })
  orderStatus!: number;

  @ApiProperty({ description: 'payStatus', example: 1, type: Number })
  payStatus!: number;

  @ApiProperty({ description: 'refundStatus', example: 0, type: Number })
  refundStatus!: number;

  @ApiProperty({ type: Number, description: 'paidAt', example: null })
  @DateToTimestamp()
  paidAt!: number;

  @ApiProperty({ description: 'treasure', type: TreasureDTo })
  @Type(() => TreasureDTo)
  treasure!: TreasureDTo;

  @ApiProperty({ description: 'groupInfo', type: groupDto, nullable: true })
  @Type(() => groupDto)
  group!: groupDto | null;
}
