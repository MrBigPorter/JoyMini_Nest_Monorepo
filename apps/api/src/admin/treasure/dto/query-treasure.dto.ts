import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ToNumber } from '@api/common/dto/transforms';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const TREASURE_FILTER_TYPE_VALUES = [
  'ALL',
  'ON_SALE',
  'PRE_SALE',
  'NOT_EXPIRED',
] as const;

export class QueryTreasureDto {
  @ApiProperty({ description: 'page', example: 1, type: 'number' })
  @IsNotEmpty()
  @ToNumber()
  @IsInt()
  @Min(1)
  @Max(100)
  page!: number;

  @ApiProperty({ description: 'page size', example: 10, type: 'number' })
  @IsNotEmpty()
  @ToNumber()
  @IsInt()
  @Min(1)
  pageSize!: number;

  @ApiPropertyOptional({
    description: 'category id',
    example: 1,
    type: 'number',
  })
  @IsOptional()
  @ToNumber()
  @IsInt()
  categoryId?: number;

  @ApiPropertyOptional({
    description: 'treasure name',
    example: 'treasure',
    type: 'string',
  })
  @IsOptional()
  @IsString()
  treasureName?: string;

  @ApiPropertyOptional({
    description: 'filter type',
    example: 'PRE_SALE',
    enum: TREASURE_FILTER_TYPE_VALUES,
  })
  @IsOptional()
  @IsString()
  filterType?: string;
}
