import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Exclude } from 'class-transformer';
import { DecimalToString, DateToTimestamp } from '@api/common/dto/transforms';
import { FieldMeta } from '@lucky/shared';

@Exclude()
export class TransactionResponseDto {
  @FieldMeta({ label: { zh: '交易编号', en: 'Transaction No' } })
  @ApiProperty({ example: 'txn_123456', description: 'Transaction ID' })
  @Expose()
  transactionNo!: string;

  @FieldMeta({
    label: { zh: '交易类型', en: 'Transaction Type' },
    enum: {
      1: { zh: '充值', en: 'Recharge' },
      2: { zh: '消费', en: 'Consumption' },
      3: { zh: '退款', en: 'Refund' },
      4: { zh: '奖励', en: 'Reward' },
      5: { zh: '提现', en: 'Withdrawal' },
      6: { zh: '金币兑换', en: 'Coin Exchange' },
      7: { zh: '邀请奖励', en: 'Invite Reward' },
      8: { zh: '系统扣减', en: 'System Deduct' },
    },
  })
  @ApiProperty({ example: 3, description: 'Transaction Type' })
  @Expose()
  transactionType!: number;

  @FieldMeta({ label: { zh: '金额', en: 'Amount' }, type: 'amount' })
  @ApiProperty({ example: '250.00', description: 'Transaction Amount' })
  @Expose()
  @DecimalToString()
  amount!: string;

  @FieldMeta({
    label: { zh: '余额类型', en: 'Balance Type' },
    enum: {
      1: { zh: '现金', en: 'Cash' },
      2: { zh: '金币', en: 'Coin' },
    },
  })
  @ApiProperty({
    example: 1,
    description: 'Balance Type: 1 for Cash, 2 for Coin',
  })
  @Expose()
  balanceType!: number;

  @FieldMeta({ label: { zh: '交易时间', en: 'Transaction Time' }, type: 'date' })
  @ApiProperty({
    example: '2024-06-01T12:00:00Z',
    description: 'Transaction Creation Time',
  })
  @Expose()
  @DateToTimestamp()
  createdAt!: number;

  @FieldMeta({ label: { zh: '关联单号', en: 'Related ID' } })
  @ApiPropertyOptional({
    example: 'ord_654321',
    description: 'Related Order ID',
  })
  @Expose()
  relatedId?: string;

  @FieldMeta({ label: { zh: '备注', en: 'Description' } })
  @ApiPropertyOptional({
    example: 'Payment for order ord_654321',
    description: 'Transaction Description',
  })
  @Expose()
  description?: string;
}
