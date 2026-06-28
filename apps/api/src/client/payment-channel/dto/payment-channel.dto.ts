import { ApiProperty } from '@nestjs/swagger';
import { DecimalToString } from '@api/common/dto/transforms';
import { Exclude, Expose, Type } from 'class-transformer';
import { FieldMeta } from '@lucky/shared';

@Exclude()
export class PaymentConfigItemDto {
  @ApiProperty({ description: '渠道ID (下单传此ID)', example: 1 })
  @Expose()
  @FieldMeta({ label: { zh: '渠道ID', en: 'Channel ID' } })
  id!: number;

  @ApiProperty({
    description: '渠道编码 (前端做UI逻辑可能用到)',
    example: 'PH_GCASH',
  })
  @Expose()
  @FieldMeta({ label: { zh: '渠道编码', en: 'Channel Code' } })
  code!: string;

  @ApiProperty({ description: '渠道名称', example: 'GCash' })
  @Expose()
  @FieldMeta({ label: { zh: '渠道名称', en: 'Channel Name' } })
  name!: string;

  @ApiProperty({
    description: '图标',
    example: 'https://cdn.com/icons/gcash.png',
  })
  @Expose()
  @FieldMeta({ label: { zh: '图标', en: 'Icon' } })
  icon!: string;

  @ApiProperty({ description: '单笔最小限额', example: 50 })
  @DecimalToString()
  @Expose()
  @FieldMeta({ label: { zh: '最小金额', en: 'Min Amount' }, type: 'amount' })
  minAmount!: string;

  @ApiProperty({ description: '单笔最大限额', example: 50000 })
  @DecimalToString()
  @Expose()
  @FieldMeta({ label: { zh: '最大金额', en: 'Max Amount' }, type: 'amount' })
  maxAmount!: string;

  @ApiProperty({
    description: '快捷金额卡片 (仅充值有效)',
    example: [100, 200, 500],
    type: [Number],
  })
  @Expose()
  fixedAmounts!: number[];

  @ApiProperty({
    description: '用户需要支付的手续费 (仅提现有效)',
    example: 15,
  })
  @Expose({ name: 'feeFixed' })
  @DecimalToString()
  @FieldMeta({ label: { zh: '手续费', en: 'Fee' }, type: 'amount' })
  fee!: string;

  @ApiProperty({ description: '是否允许输入自定义金额', example: true })
  @Expose()
  @FieldMeta({ label: { zh: '自定义金额', en: 'Custom Amount' } })
  isCustom!: boolean;
}
