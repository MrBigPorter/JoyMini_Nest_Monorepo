import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { FieldMeta } from '@lucky/shared';

export class FlashSaleSessionItemDto {
  @FieldMeta({ label: { zh: '场次 ID', en: 'Session ID' } })
  @ApiProperty()
  id!: string;

  @FieldMeta({ label: { zh: '场次标题', en: 'Session Title' } })
  @ApiProperty()
  title!: string;

  @FieldMeta({ label: { zh: '开始时间', en: 'Start Time' }, type: 'date' })
  @ApiProperty({ description: 'Session start timestamp (ms)' })
  startTime!: number;

  @FieldMeta({ label: { zh: '结束时间', en: 'End Time' }, type: 'date' })
  @ApiProperty({ description: 'Session end timestamp (ms)' })
  endTime!: number;

  @FieldMeta({
    label: { zh: '状态', en: 'Status' },
    enum: {
      0: { zh: '已结束', en: 'Inactive' },
      1: { zh: '进行中', en: 'Active' },
    },
  })
  @ApiProperty({ description: '1=active 0=inactive' })
  status!: number;

  @FieldMeta({ label: { zh: '商品数量', en: 'Product Count' } })
  @ApiProperty({ description: 'Number of products bound to the session' })
  productCount!: number;

  @FieldMeta({ label: { zh: '剩余时间(ms)', en: 'Remaining (ms)' } })
  @ApiProperty({
    description: 'Milliseconds remaining before the session ends',
  })
  remainingMs!: number;
}

export class FlashSaleTreasureSummaryDto {
  @FieldMeta({ label: { zh: '商品 ID', en: 'Treasure ID' } })
  @ApiProperty()
  treasureId!: string;

  @FieldMeta({ label: { zh: '商品名称', en: 'Treasure Name' } })
  @ApiProperty()
  treasureName!: string;

  @FieldMeta({ label: { zh: '产品名称', en: 'Product Name' } })
  @ApiProperty({ required: false, nullable: true })
  productName!: string | null;

  @FieldMeta({ label: { zh: '封面图', en: 'Cover Image' } })
  @ApiProperty({ required: false, nullable: true })
  treasureCoverImg!: string | null;

  @FieldMeta({ label: { zh: '单价', en: 'Unit Price' } })
  @ApiProperty({ description: 'Regular product price as string' })
  unitAmount!: string;

  @FieldMeta({ label: { zh: '市场价', en: 'Market Price' } })
  @ApiProperty({ required: false, nullable: true })
  marketAmount!: string | null;
}

export class FlashSaleTreasureDetailDto extends FlashSaleTreasureSummaryDto {
  @FieldMeta({ label: { zh: '商品编号', en: 'Treasure No.' } })
  @ApiProperty({ required: false, nullable: true })
  treasureSeq!: string | null;

  @FieldMeta({ label: { zh: '商品图片', en: 'Images' } })
  @ApiProperty({ type: [String] })
  mainImageList!: string[];

  @FieldMeta({ label: { zh: '商品描述', en: 'Description' } })
  @ApiProperty({ required: false, nullable: true })
  desc!: string | null;

  @FieldMeta({ label: { zh: '活动规则', en: 'Rules' } })
  @ApiProperty({ required: false, nullable: true })
  ruleContent!: string | null;

  @FieldMeta({ label: { zh: '配送方式', en: 'Shipping Type' } })
  @ApiProperty()
  shippingType!: number;

  @FieldMeta({ label: { zh: '团购人数', en: 'Group Size' } })
  @ApiProperty()
  groupSize!: number;

  @FieldMeta({ label: { zh: '状态', en: 'State' } })
  @ApiProperty()
  state!: number;

  @FieldMeta({ label: { zh: '开售时间', en: 'Sales Start' }, type: 'date' })
  @ApiProperty({ required: false, nullable: true })
  salesStartAt!: number | null;

  @FieldMeta({ label: { zh: '售罄时间', en: 'Sales End' }, type: 'date' })
  @ApiProperty({ required: false, nullable: true })
  salesEndAt!: number | null;
}

export class FlashSaleProductItemDto {
  @FieldMeta({ label: { zh: '产品 ID', en: 'Product ID' } })
  @ApiProperty()
  id!: string;

  @FieldMeta({ label: { zh: '场次 ID', en: 'Session ID' } })
  @ApiProperty()
  sessionId!: string;

  @FieldMeta({ label: { zh: '商品 ID', en: 'Treasure ID' } })
  @ApiProperty()
  treasureId!: string;

  @FieldMeta({ label: { zh: '闪购库存', en: 'Flash Stock' } })
  @ApiProperty()
  flashStock!: number;

  @FieldMeta({ label: { zh: '闪购价', en: 'Flash Price' } })
  @ApiProperty({ description: 'Flash sale price as string' })
  flashPrice!: string;

  @FieldMeta({ label: { zh: '排序', en: 'Sort Order' } })
  @ApiProperty()
  sortOrder!: number;

  @FieldMeta({ label: { zh: '已售罄', en: 'Sold Out' } })
  @ApiProperty()
  isSoldOut!: boolean;

  @FieldMeta({
    label: { zh: '商品信息', en: 'Product Info' },
    dtoClass: FlashSaleTreasureSummaryDto,
  })
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
  @FieldMeta({ label: { zh: '产品 ID', en: 'Product ID' } })
  @ApiProperty()
  id!: string;

  @FieldMeta({ label: { zh: '场次 ID', en: 'Session ID' } })
  @ApiProperty()
  sessionId!: string;

  @FieldMeta({ label: { zh: '商品 ID', en: 'Treasure ID' } })
  @ApiProperty()
  treasureId!: string;

  @FieldMeta({ label: { zh: '闪购库存', en: 'Flash Stock' } })
  @ApiProperty()
  flashStock!: number;

  @FieldMeta({ label: { zh: '闪购价', en: 'Flash Price' } })
  @ApiProperty({ description: 'Flash sale price as string' })
  flashPrice!: string;

  @FieldMeta({ label: { zh: '排序', en: 'Sort Order' } })
  @ApiProperty()
  sortOrder!: number;

  @FieldMeta({ label: { zh: '已售罄', en: 'Sold Out' } })
  @ApiProperty()
  isSoldOut!: boolean;

  @FieldMeta({
    label: { zh: '场次信息', en: 'Session Info' },
    dtoClass: FlashSaleSessionItemDto,
  })
  @ApiProperty({ type: FlashSaleSessionItemDto })
  @Type(() => FlashSaleSessionItemDto)
  session!: FlashSaleSessionItemDto;

  @FieldMeta({
    label: { zh: '商品详情', en: 'Product Detail' },
    dtoClass: FlashSaleTreasureDetailDto,
  })
  @ApiProperty({ type: FlashSaleTreasureDetailDto })
  @Type(() => FlashSaleTreasureDetailDto)
  product!: FlashSaleTreasureDetailDto;
}
