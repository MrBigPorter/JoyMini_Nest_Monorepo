import {
  IsString,
  IsOptional,
  IsEnum,
  IsArray,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArticleStatus } from '@prisma/client';

export class CreateArticleDto {
  @ApiProperty({
    description: '文章标题',
    example: '如何使用 NestJS 开发博客系统',
  })
  @IsString()
  @MaxLength(255)
  title!: string;

  @ApiProperty({ description: '文章内容' })
  @IsString()
  content!: string;

  @ApiPropertyOptional({ description: '文章摘要' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  excerpt?: string;

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

  @ApiPropertyOptional({ description: '英文标题' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  titleEn?: string;

  @ApiPropertyOptional({ description: '英文内容' })
  @IsOptional()
  @IsString()
  contentEn?: string;

  @ApiPropertyOptional({ description: '英文摘要' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  excerptEn?: string;
}
