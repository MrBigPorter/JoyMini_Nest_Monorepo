import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class FlashSaleSessionItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ description: 'Session start timestamp (ms)' })
  startTime!: number;

  @ApiProperty({ description: 'Session end timestamp (ms)' })
  endTime!: number;

  @ApiProperty({ description: '1=active 0=inactive' })
  status!: number;

  @ApiProperty({ description: 'Number of products bound to the session' })
  productCount!: number;

  @ApiProperty({
    description: 'Milliseconds remaining before the session ends',
  })
  remainingMs!: number;
}

export class FlashSaleTreasureSummaryDto {
  @ApiProperty()
  treasureId!: string;

  @ApiProperty()
  treasureName!: string;

  @ApiProperty({ required: false, nullable: true })
  productName!: string | null;

  @ApiProperty({ required: false, nullable: true })
  treasureCoverImg!: string | null;

  @ApiProperty({ description: 'Regular product price as string' })
  unitAmount!: string;

  @ApiProperty({ required: false, nullable: true })
  marketAmount!: string | null;
}

export class FlashSaleTreasureDetailDto extends FlashSaleTreasureSummaryDto {
  @ApiProperty({ required: false, nullable: true })
  treasureSeq!: string | null;

  @ApiProperty({ type: [String] })
  mainImageList!: string[];

  @ApiProperty({ required: false, nullable: true })
  desc!: string | null;

  @ApiProperty({ required: false, nullable: true })
  ruleContent!: string | null;

  @ApiProperty()
  shippingType!: number;

  @ApiProperty()
  groupSize!: number;

  @ApiProperty()
  state!: number;

  @ApiProperty({ required: false, nullable: true })
  salesStartAt!: number | null;

  @ApiProperty({ required: false, nullable: true })
  salesEndAt!: number | null;
}

export class FlashSaleProductItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  sessionId!: string;

  @ApiProperty()
  treasureId!: string;

  @ApiProperty()
  flashStock!: number;

  @ApiProperty({ description: 'Flash sale price as string' })
  flashPrice!: string;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty()
  isSoldOut!: boolean;

  @ApiProperty({ type: FlashSaleTreasureSummaryDto })
  @Type(() => FlashSaleTreasureSummaryDto)
  product!: FlashSaleTreasureSummaryDto;
}

export class FlashSaleSessionListResponseDto {
  @ApiProperty({ type: [FlashSaleSessionItemDto] })
  @Type(() => FlashSaleSessionItemDto)
  list!: FlashSaleSessionItemDto[];
}

export class FlashSaleSessionProductsResponseDto {
  @ApiProperty({ type: FlashSaleSessionItemDto })
  @Type(() => FlashSaleSessionItemDto)
  session!: FlashSaleSessionItemDto;

  @ApiProperty({ type: [FlashSaleProductItemDto] })
  @Type(() => FlashSaleProductItemDto)
  list!: FlashSaleProductItemDto[];
}

export class FlashSaleProductDetailResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  sessionId!: string;

  @ApiProperty()
  treasureId!: string;

  @ApiProperty()
  flashStock!: number;

  @ApiProperty({ description: 'Flash sale price as string' })
  flashPrice!: string;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty()
  isSoldOut!: boolean;

  @ApiProperty({ type: FlashSaleSessionItemDto })
  @Type(() => FlashSaleSessionItemDto)
  session!: FlashSaleSessionItemDto;

  @ApiProperty({ type: FlashSaleTreasureDetailDto })
  @Type(() => FlashSaleTreasureDetailDto)
  product!: FlashSaleTreasureDetailDto;
}
