import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ToTrimmedString } from '@api/common/dto/transforms';

const TREASURE_FILTER_TYPE_VALUES = [
  'ALL',
  'ON_SALE',
  'PRE_SALE',
  'NOT_EXPIRED',
] as const;

export class TreasureQueryDto {
  @ApiPropertyOptional({ description: 'page', example: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ description: 'page size', example: 20, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  categoryId?: number;

  @ApiPropertyOptional({
    description: 'state (0=blocked, 1=enabled)',
    example: 1,
    type: Number,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  state?: number;

  @ApiPropertyOptional({
    description: 'search for keyword',
    example: 'iphone',
    type: String,
  })
  @IsOptional()
  @IsString()
  @ToTrimmedString()
  q?: string;

  @ApiPropertyOptional({
    description: 'filter type',
    example: 'PRE_SALE',
    enum: TREASURE_FILTER_TYPE_VALUES,
  })
  @IsOptional()
  @IsString()
  filterType?: string;
}
