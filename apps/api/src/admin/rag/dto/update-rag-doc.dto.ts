import { IsString, IsOptional, IsArray, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateRagDocDto {
  @IsString()
  @IsOptional()
  @MaxLength(255)
  @ApiPropertyOptional({ description: '文档标题', maxLength: 255 })
  title?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  @ApiPropertyOptional({
    description: '域名',
    enum: [
      'order',
      'wallet',
      'coupon',
      'product',
      'user',
      'kyc',
      'lucky-draw',
      'common',
    ],
  })
  domain?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  @ApiPropertyOptional({ description: '文档唯一标识（slug）', maxLength: 100 })
  docId?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  @ApiPropertyOptional({ description: '关键词标签', type: [String] })
  keywords?: string[];

  @IsString()
  @IsOptional()
  @MaxLength(10)
  @ApiPropertyOptional({ description: '语言', default: 'en' })
  locale?: string;

  @IsString()
  @IsOptional()
  @MaxLength(30)
  @ApiPropertyOptional({
    description: '内容类型',
    enum: ['policy', 'how-to', 'troubleshooting', 'faq', 'reference'],
  })
  contentType?: string;

  @IsString()
  @IsOptional()
  @MaxLength(5)
  @ApiPropertyOptional({
    description: '优先级',
    enum: ['P0', 'P1', 'P2'],
  })
  priority?: string;

  @IsString()
  @IsOptional()
  @ApiPropertyOptional({ description: '文档正文 Markdown' })
  content?: string;
}
