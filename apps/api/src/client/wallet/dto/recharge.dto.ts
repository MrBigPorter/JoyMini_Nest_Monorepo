import { IsOptional, IsInt, Min } from 'class-validator';
import { Exclude, Expose, Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { DateToTimestamp, DecimalToString } from '@api/common/dto/transforms';
import { PaginatedResponseDto } from '@api/common/dto/paginated-response.dto';
import { FieldMeta } from '@lucky/shared';

@Exclude()
export class GetRechargeHistoryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  @Expose()
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  @Expose()
  pageSize?: number = 10;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Expose()
  status?: number; // 对应 rechargeStatus: 1-待支付, 2-支付中...
}

@Exclude()
export class RechargeHistoryItemDto {
  @FieldMeta({ label: { zh: '充值编号', en: 'Recharge No' } })
  @ApiProperty({ description: '充值订单号', example: 'RO123456789' })
  @Expose()
  rechargeNo!: string;

  @FieldMeta({ label: { zh: '充值金额', en: 'Amount' }, type: 'amount' })
  @ApiProperty({ description: '充值金额 (字符串格式)', example: '100.00' })
  @DecimalToString()
  @Expose()
  rechargeAmount!: string;

  @FieldMeta({ label: { zh: '实际到账', en: 'Actual Amount' }, type: 'amount' })
  @ApiProperty({ description: '实际到账金额 (字符串格式)', example: '100.00' })
  @DecimalToString()
  @Expose()
  actualAmount!: string;

  @FieldMeta({
    label: { zh: '充值状态', en: 'Recharge Status' },
    enum: {
      1: { zh: '待支付', en: 'Pending' },
      2: { zh: '支付中', en: 'Processing' },
      3: { zh: '充值成功', en: 'Success' },
      4: { zh: '充值失败', en: 'Failed' },
      5: { zh: '已取消', en: 'Canceled' },
    },
  })
  @ApiProperty({
    description: '充值状态: 1-待支付 2-支付中 3-充值成功 4-充值失败 5-已取消',
    example: 1,
  })
  @Expose()
  rechargeStatus!: number;

  @FieldMeta({
    label: { zh: '支付方式', en: 'Payment Method' },
    enum: {
      1: { zh: 'GCash', en: 'GCash' },
      2: { zh: 'PayMaya', en: 'PayMaya' },
      3: { zh: '银行转账', en: 'Bank Transfer' },
      4: { zh: '银行卡', en: 'Card' },
    },
  })
  @ApiProperty({
    description: '支付方式: 1-GCash 2-PayMaya 3-Bank 4-Card',
    example: 1,
  })
  @Expose()
  paymentMethod!: number;

  @FieldMeta({ label: { zh: '渠道名称', en: 'Channel Name' } })
  @ApiProperty({ description: '渠道名称', example: 'GCash', required: false })
  @Expose()
  paymentChannel?: string;

  @FieldMeta({ label: { zh: '渠道编码', en: 'Channel Code' } })
  @ApiProperty({
    description: '渠道编码',
    example: 'PH_GCASH',
    required: false,
  })
  @Expose()
  channelCode?: string;

  @FieldMeta({ label: { zh: '创建时间', en: 'Created At' }, type: 'date' })
  @ApiProperty({ description: '创建时间 (毫秒时间戳)', example: 1704067200000 })
  @DateToTimestamp()
  @Expose()
  createdAt!: number;

  @FieldMeta({ label: { zh: '支付时间', en: 'Paid At' }, type: 'date' })
  @ApiProperty({
    description: '支付时间 (毫秒时间戳), 未支付为 null',
    required: false,
    example: null,
  })
  @DateToTimestamp()
  @Expose()
  paidAt!: number;
}

@Exclude()
export class RechargeHistoryResponseDto extends PaginatedResponseDto<RechargeHistoryItemDto> {
  @ApiProperty({ description: '列表数据', type: [RechargeHistoryItemDto] })
  @Type(() => RechargeHistoryItemDto)
  list!: RechargeHistoryItemDto[];
}

@Exclude()
export class RechargeStatusResponseDto {
  @ApiProperty({ description: '充值订单号', example: 'R1234567890' })
  @Expose()
  orderNo!: string;

  @ApiProperty({ description: '充值金额 (Decimal)', example: 100.0 })
  @DecimalToString()
  @Expose()
  amount!: string;

  @ApiProperty({
    description: '订单当前状态',
    enum: ['PROCESSING', 'SUCCESS', 'FAILED'],
    example: 'PROCESSING',
  })
  @Expose()
  status!: string;

  @ApiProperty({ description: '订单创建时间' })
  @DateToTimestamp()
  @Expose()
  createdAt!: number;
}
