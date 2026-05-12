import {
  IsString,
  IsOptional,
  IsIn,
  IsArray,
  IsObject,
  IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { LocalizedString } from '@lucky/shared';

const ARTICLE_STATUS_VALUES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;

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

  @ApiPropertyOptional({
    description: '特色图片 URL (featuredImage) - 支持字符串或多语言对象',
  })
  @IsOptional()
  featuredImage?: string | LocalizedString<string>;

  @ApiPropertyOptional({
    description: '文章状态',
    enum: ARTICLE_STATUS_VALUES,
    default: 'DRAFT',
  })
  @IsOptional()
  @IsIn(ARTICLE_STATUS_VALUES as unknown as string[])
  status?: (typeof ARTICLE_STATUS_VALUES)[number];

  @ApiPropertyOptional({ description: '分类 ID' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({ description: '标签 ID 列表', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tagIds?: string[];

  @ApiPropertyOptional({
    description: '是否精选文章（首页展示）',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  featured?: boolean;

  @ApiPropertyOptional({
    description: '文章元数据（图片变体、视频信息等）',
    example: {
      images: {
        blurhash: 'LKO2?U%2Tw=w]~RBVZR}[4@?ngkB',
        original: 'https://cdn.example.com/uploads/article/xxx/original.jpg',
        large: { webp: '...', jpg: '...' },
        medium: { webp: '...', jpg: '...' },
        thumbnail: { webp: '...', jpg: '...' },
      },
      video: {
        playlist: 'https://cdn.example.com/uploads/article/xxx/playlist.m3u8',
        segments: ['...'],
      },
    },
  })
  @IsOptional()
  @IsObject()
  meta?: Record<string, any>;
}
