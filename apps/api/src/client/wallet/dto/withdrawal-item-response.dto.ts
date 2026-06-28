import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Exclude } from 'class-transformer';
import {
  DecimalToString,
  DateToTimestamp,
  MaskString,
} from '@api/common/dto/transforms';
import { FieldMeta } from '@lucky/shared';

@Exclude()
export class WithdrawalItemResponseDto {
  @FieldMeta({ label: { zh: '提现编号', en: 'Withdraw No' } })
  @ApiProperty({ example: 'wd_123456', description: 'Withdrawal ID' })
  @Expose()
  withdrawNo!: string;

  @FieldMeta({ label: { zh: '提现金额', en: 'Amount' }, type: 'amount' })
  @ApiProperty({ example: 'Bank Transfer', description: 'Withdrawal Method' })
  @Expose()
  @DecimalToString()
  amount!: string;

  @FieldMeta({ label: { zh: '到账金额', en: 'Withdraw Amount' }, type: 'amount' })
  @ApiProperty({ example: 'Bank Transfer', description: 'Withdrawal Method' })
  @Expose()
  @DecimalToString()
  withdrawAmount!: string;

  @FieldMeta({ label: { zh: '实际到账', en: 'Actual Amount' }, type: 'amount' })
  @ApiProperty({ example: 'Bank Transfer', description: 'Withdrawal Method' })
  @Expose()
  @DecimalToString()
  actualAmount!: string;

  @FieldMeta({ label: { zh: '手续费', en: 'Fee' }, type: 'amount' })
  @ApiProperty({ example: '100.00', description: 'Withdrawal Amount' })
  @Expose()
  @DecimalToString()
  feeAmount!: string;

  @FieldMeta({
    label: { zh: '提现状态', en: 'Withdraw Status' },
    enum: {
      1: { zh: '待审核', en: 'Pending Audit' },
      2: { zh: '审核通过', en: 'Approved' },
      3: { zh: '处理中', en: 'Processing' },
      4: { zh: '提现成功', en: 'Success' },
      5: { zh: '审核拒绝', en: 'Rejected' },
      6: { zh: '提现失败', en: 'Failed' },
    },
  })
  @ApiProperty({ description: 'withdrawStatus', example: 1 })
  @Expose()
  withdrawStatus!: number;

  @FieldMeta({ label: { zh: '申请时间', en: 'Created At' }, type: 'date' })
  @ApiProperty({
    example: '2024-06-01T12:00:00Z',
    description: 'Creation Time',
  })
  @Expose()
  @DateToTimestamp()
  createdAt!: number;

  @FieldMeta({ label: { zh: '审核时间', en: 'Audited At' }, type: 'date' })
  @ApiPropertyOptional({
    example: '2024-06-02T12:00:00Z',
    description: 'Audit Time',
  })
  @Expose()
  @DateToTimestamp()
  auditedAt?: number;

  @FieldMeta({ label: { zh: '完成时间', en: 'Completed At' }, type: 'date' })
  @ApiPropertyOptional({
    example: '2024-06-03T12:00:00Z',
    description: 'Completion Time',
  })
  @Expose()
  @DateToTimestamp()
  completedAt?: number;

  @FieldMeta({ label: { zh: '拒绝原因', en: 'Reject Reason' } })
  @ApiPropertyOptional({
    example: 'Insufficient funds',
    description: 'Rejection Reason',
  })
  @Expose()
  rejectReason?: string;

  @FieldMeta({ label: { zh: '账户名称', en: 'Account Name' } })
  @ApiProperty({ example: 'John Doe', description: 'Account Name' })
  @Expose()
  accountName!: string;

  @FieldMeta({ label: { zh: '提现账户', en: 'Withdraw Account' } })
  @ApiProperty({
    example: '**** **** **** 1234',
    description: 'Masked Account Number',
  })
  @Expose()
  @MaskString('bankcard')
  withdrawAccount!: string;

  @FieldMeta({ label: { zh: '渠道名称', en: 'Channel Name' } })
  @ApiPropertyOptional({
    example: 'GCash',
    description: 'Channel Name (was bankName)',
  })
  @Expose()
  channelName?: string; // 对应 Service 里的 formattedList 映射

  @FieldMeta({ label: { zh: '渠道代码', en: 'Channel Code' } })
  @ApiPropertyOptional({
    example: 'PH_GCASH',
    description: 'Channel Code for Icon',
  })
  @Expose()
  channelCode?: string; // 对应数据库 channelCode
}
