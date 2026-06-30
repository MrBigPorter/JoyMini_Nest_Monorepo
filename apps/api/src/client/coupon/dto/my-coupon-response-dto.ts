import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose, Type, Transform } from 'class-transformer';
import { DateToTimestamp, DecimalToString } from '@api/common/dto/transforms';
import { PaginatedResponseDto } from '@api/common/dto/paginated-response.dto';
import { FieldMeta } from '@lucky/shared';

@Exclude()
export class MyCouponResponseDto {
  @FieldMeta({ label: { zh: '优惠券实例 ID', en: 'Coupon Instance ID' } })
  @ApiProperty({ description: '用户领取的优惠券实例 ID (userCoupon 表主键)' })
  @Expose()
  userCouponId!: string;

  @FieldMeta({ label: { zh: '状态', en: 'Status' } })
  @ApiProperty({ description: '状态: 0-未使用, 1-已使用, 2-已过期' })
  @Expose()
  status!: number;

  @FieldMeta({ label: { zh: '有效开始时间', en: 'Valid From' }, type: 'date' })
  @ApiProperty({ description: '有效开始时间' })
  @Expose()
  @DateToTimestamp()
  validStartAt!: number;

  @FieldMeta({ label: { zh: '有效结束时间', en: 'Valid Until' }, type: 'date' })
  @ApiProperty({ description: '有效结束时间' })
  @Expose()
  @DateToTimestamp()
  validEndAt!: number;

  @FieldMeta({ label: { zh: '优惠券名称', en: 'Coupon Name' } })
  @ApiProperty({ description: '优惠券名称' })
  @Expose()
  couponName!: string;

  @FieldMeta({ label: { zh: '优惠券类型', en: 'Coupon Type' } })
  @ApiProperty({ description: '优惠券类型' })
  @Expose()
  couponType!: number;

  @FieldMeta({ label: { zh: '优惠面值', en: 'Discount Value' }, type: 'amount' })
  @ApiProperty({ description: '优惠面值' })
  @Expose()
  @DecimalToString()
  discountValue!: string;

  @FieldMeta({ label: { zh: '最低消费门槛', en: 'Min Purchase' }, type: 'amount' })
  @ApiProperty({ description: '最低消费门槛' })
  @Expose()
  @DecimalToString()
  minPurchase!: string;

  @FieldMeta({ label: { zh: '使用规则', en: 'Rule Description' } })
  @ApiProperty({ description: '使用规则描述', nullable: true })
  @Expose()
  ruleDesc?: string;
}

export class MyCouponListResponseDto extends PaginatedResponseDto<MyCouponResponseDto> {
  @ApiProperty({ isArray: true, type: MyCouponResponseDto })
  list!: MyCouponResponseDto[];
}
