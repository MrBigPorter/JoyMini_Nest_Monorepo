import { IsString, IsOptional, IsBoolean, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdatePromptDto {
  @IsString()
  @IsOptional()
  @MaxLength(128)
  @ApiPropertyOptional({ description: 'Display name', maxLength: 128 })
  displayName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(512)
  @ApiPropertyOptional({ description: 'Description', maxLength: 512 })
  description?: string;

  @IsString()
  @IsOptional()
  @MaxLength(32)
  @ApiPropertyOptional({ description: 'Status', enum: ['active', 'inactive', 'draft', 'archived'] })
  status?: string;

  @IsBoolean()
  @IsOptional()
  @ApiPropertyOptional({ description: 'Use TS file as fallback when no DB override' })
  tsFallback?: boolean;
}
