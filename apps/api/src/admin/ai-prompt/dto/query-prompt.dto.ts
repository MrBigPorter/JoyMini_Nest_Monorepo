import { IsString, IsOptional, IsInt, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class QueryPromptDto {
  @IsString()
  @IsOptional()
  @ApiPropertyOptional({
    description: 'Filter by category',
    enum: ['agent', 'system', 'intent'],
  })
  category?: string;

  @IsString()
  @IsOptional()
  @ApiPropertyOptional({ description: 'Filter by domain' })
  domain?: string;

  @IsString()
  @IsOptional()
  @ApiPropertyOptional({
    description: 'Filter by status',
    enum: ['active', 'inactive', 'draft', 'archived'],
  })
  status?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  @ApiPropertyOptional({ description: 'Page number (1-based)', default: 1 })
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  @ApiPropertyOptional({ description: 'Page size', default: 20 })
  pageSize?: number;
}
