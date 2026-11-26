import { ApiProperty } from '@nestjs/swagger';
import { DateToTimestamp, DecimalToString } from '@api/common/dto/transforms';
import { Type } from 'class-transformer';

export class PaymentChannelDto {
  @ApiProperty({ description: 'ID', example: 1 })
  id!: number;

  @ApiProperty({ description: '渠道编码', example: 'PH_GCASH' })
  code!: string;

  @ApiProperty({ description: '显示名称', example: 'GCash' })
  name!: string;

  @ApiProperty({ description: '图标URL', example: 'https://cdn.com/gcash.png' })
  icon!: string;

  @ApiProperty({ description: '类型: 1-充值 2-提现', example: 1 })
  type!: number;

  @ApiProperty({ description: '最小金额 (Number)', example: 100 })
  @DecimalToString()
  minAmount!: string;

  @ApiProperty({ description: '最大金额 (Number)', example: 50000 })
  @DecimalToString()
  maxAmount!: string;

  @ApiProperty({
    description: '固定金额选项',
    example: [100, 200, 500],
    type: [Number],
    required: false,
  })
  fixedAmounts!: number[];

  @ApiProperty({ description: '是否允许自定义金额', example: true })
  isCustom!: boolean;

  @ApiProperty({ description: '固定手续费', example: 15 })
  @DecimalToString()
  feeFixed!: string;

  @ApiProperty({ description: '费率 (0.02=2%)', example: 0.02 })
  // 列是 Decimal(5,4)：0.0080（0.8%）必须原样输出。
  // 默认 2 位会把 0.0080 舍成 "0.01"，后台显示与真值校验都会读错费率。
  @DecimalToString(4)
  feeRate!: string;

  @ApiProperty({ description: '排序', example: 1 })
  sortOrder!: number;

  @ApiProperty({ description: '状态: 0-禁用 1-启用', example: 1 })
  status!: number;

  @ApiProperty({ description: '创建时间' })
  @DateToTimestamp()
  createdAt!: number; // 建议转时间戳返回
}

export class PaymentChannelListResponse {
  @ApiProperty({ type: [PaymentChannelDto] })
  @Type(() => PaymentChannelDto)
  list!: PaymentChannelDto[];
}
