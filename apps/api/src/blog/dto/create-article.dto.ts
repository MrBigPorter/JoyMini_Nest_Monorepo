import {
  IsString,
  IsOptional,
  IsEnum,
  IsArray,
  MaxLength,
  IsObject,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArticleStatus } from '@prisma/client';
import type { LocalizedString } from '@lucky/shared';

export class CreateArticleDto {
  @ApiProperty({
    description: '文章标题 (多语言)',
    example: {
      zh: '如何使用 NestJS 开发博客系统',
      en: 'How to build blog system with NestJS',
    },
  })
  @IsObject()
  title!: LocalizedString<string>;

  @ApiProperty({ description: '文章内容 (多语言)' })
  @IsObject()
  content!: LocalizedString<string>;

  @ApiPropertyOptional({ description: '文章摘要 (多语言)' })
  @IsOptional()
  @IsObject()
  excerpt?: LocalizedString<string>;

  @ApiPropertyOptional({ description: '特色图片 URL (featuredImage)' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  featuredImage?: string;

  @ApiPropertyOptional({
    description: '文章状态',
    enum: ArticleStatus,
    default: ArticleStatus.DRAFT,
  })
  @IsOptional()
  @IsEnum(ArticleStatus)
  status?: ArticleStatus;

  @ApiPropertyOptional({ description: '分类 ID' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({ description: '标签 ID 列表', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tagIds?: string[];
}
