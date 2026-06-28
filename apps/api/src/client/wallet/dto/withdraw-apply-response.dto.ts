import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { DecimalToString } from '@api/common/dto/transforms';
import { FieldMeta } from '@lucky/shared';

@Exclude()
export class WithdrawApplyResponseDto {
  @FieldMeta({ label: { zh: '提现ID', en: 'Withdraw ID' } })
  @ApiProperty({ description: 'Withdrawal ID', example: 'withdraw_12345' })
  @Expose()
  withdrawId!: string;

  @FieldMeta({ label: { zh: '提现编号', en: 'Withdraw No' } })
  @ApiProperty({ description: 'Withdrawal Number', example: 'WD202406010001' })
  @Expose()
  withdrawNo!: string;

  @FieldMeta({ label: { zh: '提现金额', en: 'Withdraw Amount' }, type: 'amount' })
  @ApiProperty({ description: 'Withdrawal Amount', example: '150.75' })
  @Expose()
  @DecimalToString()
  withdrawAmount!: string;

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
  @ApiProperty({ description: 'Withdrawal Status', example: 1 })
  @Expose()
  withdrawStatus!: number;
}
