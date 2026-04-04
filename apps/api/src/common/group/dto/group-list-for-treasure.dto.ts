import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ToBool, ToNumber } from '@api/common/dto/transforms';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GroupListForTreasureDto {
  @ApiProperty({ description: 'treasureId', example: '1', type: String })
  @IsOptional()
  @IsString()
  treasureId?: string;

  @ApiProperty({ description: 'page', example: 1, type: Number })
  @ToNumber()
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ description: 'pageSize', example: 50, type: Number })
  @ToNumber()
  @Min(1)
  @Max(100)
  pageSize: number = 50;

  // 允许指定查询状态 (App 不传，Admin 可能传)
  @ApiPropertyOptional({ description: '拼团状态过滤', example: 1 })
  @IsOptional()
  @ToNumber()
  @IsNumber()
  status?: number;

  // ：是否包含过期团 (Admin=true, App=false)
  @ApiPropertyOptional({ description: '是否包含过期数据', example: false })
  @IsOptional()
  @ToBool()
  @IsBoolean()
  includeExpired?: boolean;
}
