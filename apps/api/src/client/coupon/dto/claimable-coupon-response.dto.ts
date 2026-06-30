import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { DecimalToString } from '@api/common/dto/transforms';
import { FieldMeta } from '@lucky/shared';

@Exclude()
export class ClaimableCouponResponseDto {
  @FieldMeta({ label: { zh: '优惠券模板 ID', en: 'Coupon ID' } })
  @ApiProperty({ description: '优惠券模板 ID' })
  @Expose()
  couponId!: string;

  @FieldMeta({ label: { zh: '优惠券名称', en: 'Coupon Name' } })
  @ApiProperty({ description: '优惠券名称' })
  @Expose()
  couponName!: string;

  @FieldMeta({ label: { zh: '优惠券类型', en: 'Coupon Type' } })
  @ApiProperty({ description: '类型: 1-满减券 2-折扣券 3-无门槛' })
  @Expose()
  couponType!: number;

  @FieldMeta({ label: { zh: '优惠面值', en: 'Discount Value' }, type: 'amount' })
  @ApiProperty({ description: '优惠面值 (String，防止精度丢失)' })
  @Expose()
  @DecimalToString()
  discountValue!: string;

  @FieldMeta({ label: { zh: '最低消费门槛', en: 'Min Purchase' }, type: 'amount' })
  @ApiProperty({ description: '最低消费门槛' })
  @Expose()
  @DecimalToString()
  minPurchase!: string;

  @FieldMeta({ label: { zh: '发行总量', en: 'Total Quantity' } })
  @ApiProperty({ description: '发行总量 (-1 代表不限量)' })
  @Expose()
  totalQuantity!: number;

  @FieldMeta({ label: { zh: '已发放数量', en: 'Issued Quantity' } })
  @ApiProperty({ description: '已发放数量' })
  @Expose()
  issuedQuantity!: number;

  @FieldMeta({ label: { zh: '领取进度', en: 'Claim Progress' } })
  @ApiProperty({ description: '抢券进度百分比 (例如 "80" 代表 80%)' })
  @Expose()
  progress!: string;

  @FieldMeta({ label: { zh: '可领取', en: 'Can Claim' } })
  @ApiProperty({ description: '当前用户是否还可以领取' })
  @Expose()
  canClaim!: boolean;

  @FieldMeta({ label: { zh: '已达领取上限', en: 'Reached Limit' } })
  @ApiProperty({ description: '当前用户是否已经达到了个人限领上限' })
  @Expose()
  hasReachedLimit!: boolean;
}
