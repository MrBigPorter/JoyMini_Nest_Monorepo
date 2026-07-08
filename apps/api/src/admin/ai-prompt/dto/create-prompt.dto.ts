import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePromptDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @ApiProperty({
    description: 'Prompt identifier (e.g. order-agent, wallet-agent)',
    maxLength: 64,
  })
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @ApiProperty({ description: 'Display name', maxLength: 128 })
  displayName!: string;

  @IsString()
  @IsOptional()
  @MaxLength(512)
  @ApiPropertyOptional({ description: 'Description', maxLength: 512 })
  description?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  @ApiProperty({ description: 'Category', enum: ['agent', 'system', 'intent'] })
  category!: string;

  @IsString()
  @IsOptional()
  @MaxLength(32)
  @ApiPropertyOptional({
    description: 'Domain (null for system prompts)',
    maxLength: 32,
  })
  domain?: string;

  @IsOptional()
  @ApiPropertyOptional({
    description: 'Initial prompt config as JSON object',
    type: Object,
  })
  config?: Record<string, unknown>;
}
