import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsBoolean,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRagDocDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @ApiProperty({ description: '文档标题', maxLength: 255 })
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @ApiProperty({
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
  domain!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @ApiProperty({
    description: '文档唯一标识（slug），如 refund-policy',
    maxLength: 100,
  })
  docId!: string;

  @IsArray()
  @IsString({ each: true })
  @ApiProperty({ description: '关键词标签', type: [String] })
  keywords!: string[];

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
    default: 'policy',
  })
  contentType?: string;

  @IsString()
  @IsOptional()
  @MaxLength(5)
  @ApiPropertyOptional({
    description: '优先级',
    enum: ['P0', 'P1', 'P2'],
    default: 'P2',
  })
  priority?: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({ description: '文档正文 Markdown' })
  content!: string;
}
