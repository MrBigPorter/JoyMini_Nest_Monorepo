import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

/** 管理端知识库检索（评测/调试用） */
export class SearchRagDto {
  @ApiProperty({ description: '检索问题', example: '退款多久到账？' })
  @IsString()
  @IsNotEmpty()
  query!: string;

  @ApiPropertyOptional({ description: '按知识域过滤', example: 'order' })
  @IsOptional()
  @IsString()
  domain?: string;

  @ApiPropertyOptional({ description: '返回条数，默认 5，最大 20', example: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  topK?: number;

  @ApiPropertyOptional({ description: '最低分阈值（Layer3）', example: 0.1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minScore?: number;
}
