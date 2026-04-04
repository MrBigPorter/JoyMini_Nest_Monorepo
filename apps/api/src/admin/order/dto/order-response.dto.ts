import { Exclude, Expose, Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { DateToTimestamp, DecimalToString } from '@api/common/dto/transforms';

@Exclude()
export class OrderUserDto {
  @Expose() id!: string;
  @Expose() nickname!: string;
  @Expose() phone!: string;
}

@Exclude()
export class OrderTreasureDto {
  @Expose() treasureId!: string;
  @Expose() treasureName!: string;
  @Expose() treasureCoverImg!: string;
}

@Exclude()
export class OrderResponseDto {
  @ApiProperty()
  @Expose()
  orderId!: string;

  @ApiProperty()
  @Expose()
  orderNo!: string;

  // --- 金额字段 ---
  @ApiProperty()
  @Expose()
  @DecimalToString()
  originalAmount!: string;

  @ApiProperty()
  @Expose()
  @DecimalToString()
  finalAmount!: string;

  @ApiProperty()
  @Expose()
  @DecimalToString()
  couponAmount!: string;

  @ApiProperty()
  @Expose()
  @DecimalToString()
  coinAmount!: string;

  @ApiProperty()
  @Expose()
  @DecimalToString()
  unitPrice!: string;

  // --- 普通字段 ---
  @ApiProperty()
  @Expose()
  buyQuantity!: number;

  @ApiProperty()
  @Expose()
  orderStatus!: number;

  @ApiProperty()
  @Expose()
  @DateToTimestamp()
  paidAt!: number;

  @ApiProperty()
  @Expose()
  @DateToTimestamp()
  createdAt!: number;

  @ApiProperty({ type: OrderUserDto })
  @Expose()
  @Type(() => OrderUserDto)
  user!: OrderUserDto;

  @ApiProperty({ type: OrderTreasureDto })
  @Expose()
  @Type(() => OrderTreasureDto)
  treasure!: OrderTreasureDto;
}
