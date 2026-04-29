import {
  IsString,
  IsOptional,
  IsEnum,
  IsArray,
  IsObject,
  IsBoolean,
  ArrayMinSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArticleStatus } from '@prisma/client';

/**
 * 扫描结果中的单篇文章（API 响应，非 DTO）
 */
export class ScannedArticle {
  @ApiProperty({ description: '文件名 (不含路径)' })
  filename!: string;

  @ApiProperty({ description: '从文件名推导的 Slug' })
  slug!: string;

  @ApiProperty({ description: '从 Markdown 解析的标题' })
  title!: string;

  @ApiPropertyOptional({ description: '从 Markdown 解析的摘要' })
  excerpt?: string;

  @ApiProperty({ description: 'Markdown 正文内容' })
  content!: string;

  @ApiProperty({ description: '从 Tags: 行解析的标签名称列表', type: [String] })
  tags!: string[];

  @ApiPropertyOptional({
    description: '相对于 articles/ 的子目录名（用于分类映射）',
    nullable: true,
  })
  subdir!: string | null;

  @ApiProperty({
    description: 'Slug 是否已存在（数据库中已有同 slug 文章）',
  })
  exists!: boolean;

  @ApiProperty({ description: '文件大小 (bytes)' })
  fileSize!: number;

  @ApiProperty({ description: '文件最后修改时间 (ISO string)' })
  lastModified!: string;
}

/**
 * 批量导入请求中的单篇文章
 */
export class BatchImportItem {
  @ApiProperty({ description: '文件名' })
  @IsString()
  filename!: string;

  @ApiProperty({ description: 'Slug（必须唯一）' })
  @IsString()
  slug!: string;

  @ApiProperty({ description: '文章标题' })
  @IsString()
  title!: string;

  @ApiPropertyOptional({ description: '文章摘要' })
  @IsOptional()
  @IsString()
  excerpt?: string;

  @ApiProperty({ description: 'Markdown 正文' })
  @IsString()
  content!: string;

  @ApiProperty({ description: '标签名称列表', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({
    description: '子目录名（用于分类映射）',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  subdir?: string | null;

  @ApiPropertyOptional({
    description: '文章状态',
    enum: ArticleStatus,
    default: ArticleStatus.DRAFT,
  })
  @IsOptional()
  @IsEnum(ArticleStatus)
  status?: ArticleStatus;

  @ApiPropertyOptional({ description: '分类 ID（优先于 subdir 映射）' })
  @IsOptional()
  @IsString()
  categoryId?: string;
}

/**
 * 批量导入请求 DTO
 */
export class BatchImportDto {
  @ApiProperty({ description: '待导入的文章列表', type: [BatchImportItem] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BatchImportItem)
  articles!: BatchImportItem[];

  @ApiPropertyOptional({
    description: '默认文章状态',
    enum: ArticleStatus,
    default: ArticleStatus.DRAFT,
  })
  @IsOptional()
  @IsEnum(ArticleStatus)
  defaultStatus?: ArticleStatus;

  @ApiPropertyOptional({
    description: '是否覆盖已存在的文章（同 slug）',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  overwrite?: boolean;
}

/**
 * 批量导入结果项
 */
export class BatchImportResultItem {
  @ApiProperty({ description: '文件名' })
  filename!: string;

  @ApiProperty({ description: '文章 ID（成功时）' })
  @IsOptional()
  articleId?: string;

  @ApiProperty({ description: 'Slug' })
  slug!: string;

  @ApiProperty({ description: '是否成功' })
  success!: boolean;

  @ApiPropertyOptional({ description: '错误信息（失败时）' })
  error?: string;
}

/**
 * 批量导入结果
 */
export class BatchImportResult {
  @ApiProperty({ description: '成功导入数' })
  successCount!: number;

  @ApiProperty({ description: '失败数' })
  failureCount!: number;

  @ApiProperty({ description: '跳过数（已存在且未覆盖）', default: 0 })
  skippedCount!: number;

  @ApiProperty({ type: [BatchImportResultItem] })
  results!: BatchImportResultItem[];
}
