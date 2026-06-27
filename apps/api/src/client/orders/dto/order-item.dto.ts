import { ApiProperty } from '@nestjs/swagger';
import { FieldMeta } from '@lucky/shared';
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
  @FieldMeta({
    label: { zh: '商品封面名称', en: 'Treasure Name' },
  })
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
  @FieldMeta({
    label: { zh: '产品名称', en: 'Product Name' },
  })
  @ApiProperty({
    description: 'productName',
    example: 'Vase Product',
    type: String,
  })
  productName!: string;
  @FieldMeta({
    label: { zh: '商品类型', en: 'Product Type' },
    enum: {
      1: { zh: '虚拟商品', en: 'Virtual Product' },
      2: { zh: '实体商品', en: 'Physical Product' },
    },
  })
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

  @FieldMeta({
    label: { zh: '订单编号', en: 'Order No' },
  })
  @ApiProperty({
    description: 'Order No',
    example: '202406010001',
    type: String,
  })
  orderNo!: string;

  @FieldMeta({
    label: { zh: '下单时间', en: 'Order Time' },
    type: 'date',
  })
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

  @FieldMeta({
    label: { zh: '购买数量', en: 'Quantity' },
  })
  @ApiProperty({ description: 'buyQuantity', example: 2, type: Number })
  buyQuantity!: number;
  @ApiProperty({ description: 'treasureId', example: '1', type: String })
  treasureId!: string;
  @FieldMeta({
    label: { zh: '单价', en: 'Unit Price' },
    type: 'amount',
  })
  @ApiProperty({ description: 'unitPrice', example: '9.99', type: String })
  @DecimalToString()
  unitPrice!: string;

  @FieldMeta({
    label: { zh: '原价', en: 'Original Amount' },
    type: 'amount',
  })
  @ApiProperty({
    description: 'originalAmount',
    example: '19.98',
    type: String,
  })
  @DecimalToString()
  originalAmount!: string;
  @FieldMeta({
    label: { zh: '折扣金额', en: 'Discount' },
    type: 'amount',
  })
  @ApiProperty({ description: 'discountAmount', example: '2.00', type: String })
  @DecimalToString()
  discountAmount!: string;

  @FieldMeta({
    label: { zh: '优惠券抵扣', en: 'Coupon' },
    type: 'amount',
  })
  @ApiProperty({ description: 'couponAmount', example: '3.00', type: String })
  @DecimalToString()
  couponAmount!: string;
  @FieldMeta({
    label: { zh: '金币抵扣', en: 'Coins' },
    type: 'amount',
  })
  @ApiProperty({ description: 'coinAmount', example: '5.00', type: String })
  @DecimalToString()
  coinAmount!: string;

  @FieldMeta({
    label: { zh: '实付金额', en: 'Amount' },
    type: 'amount',
  })
  @ApiProperty({ description: 'finalAmount', example: '9.98', type: String })
  @DecimalToString()
  finalAmount!: string;

  @FieldMeta({
    label: { zh: '订单状态', en: 'Order Status' },
    enum: {
      1: { zh: '待支付', en: 'Pending Payment' },
      2: { zh: '支付中', en: 'Processing Payment' },
      3: { zh: '已支付', en: 'Paid' },
      4: { zh: '已取消', en: 'Cancelled' },
      5: { zh: '已退款', en: 'Refunded' },
      6: { zh: '待成团', en: 'Waiting for Group' },
      7: { zh: '待发货', en: 'Ready to Ship' },
      8: { zh: '已发货', en: 'Shipped' },
      9: { zh: '已完成', en: 'Completed' },
    },
  })
  @ApiProperty({ description: 'orderStatus', example: 1, type: Number })
  orderStatus!: number;

  @FieldMeta({
    label: { zh: '支付状态', en: 'Payment Status' },
    enum: {
      0: { zh: '未支付', en: 'Unpaid' },
      1: { zh: '已支付', en: 'Paid' },
      2: { zh: '支付失败', en: 'Failed' },
    },
  })
  @ApiProperty({ description: 'payStatus', example: 1, type: Number })
  payStatus!: number;

  @FieldMeta({
    label: { zh: '退款状态', en: 'Refund Status' },
    enum: {
      0: { zh: '未退款', en: 'No Refund' },
      1: { zh: '退款中', en: 'Refunding' },
      2: { zh: '已退款', en: 'Refunded' },
      3: { zh: '退款失败', en: 'Refund Failed' },
    },
  })
  @ApiProperty({ description: 'refundStatus', example: 0, type: Number })
  refundStatus!: number;

  @FieldMeta({
    label: { zh: '支付时间', en: 'Payment Time' },
    type: 'date',
  })
  @ApiProperty({ type: Number, description: 'paidAt', example: null })
  @DateToTimestamp()
  paidAt!: number;

  @FieldMeta({
    label: { zh: '商品信息', en: 'Product Info' },
    dtoClass: TreasureDTo,
  })
  @ApiProperty({ description: 'treasure', type: TreasureDTo })
  @Type(() => TreasureDTo)
  treasure!: TreasureDTo;

  @ApiProperty({ description: 'groupInfo', type: groupDto, nullable: true })
  @Type(() => groupDto)
  group!: groupDto | null;
}
