import { Exclude, Expose, Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { PaginatedResponseDto } from '@api/common/dto/paginated-response.dto';

@Exclude()
export class RagDocResponseDto {
  @ApiProperty()
  @Expose()
  id!: string;

  @ApiProperty()
  @Expose()
  title!: string;

  @ApiProperty()
  @Expose()
  domain!: string;

  @ApiProperty()
  @Expose()
  docId!: string;

  @ApiProperty({ type: [String] })
  @Expose()
  keywords!: string[];

  @ApiProperty()
  @Expose()
  locale!: string;

  @ApiProperty()
  @Expose()
  contentType!: string;

  @ApiProperty()
  @Expose()
  priority!: string;

  @ApiProperty()
  @Expose()
  content!: string;

  @ApiProperty({ description: 'pdf-parse 输出（诚实基准线），用于双源对撞对比' })
  @Expose()
  rawContent!: string | null;

  @ApiProperty({ description: '原始文件 R2 URL（用于 PDF 预览）' })
  @Expose()
  fileUrl!: string | null;

  @ApiProperty({ description: '双源对比结果（JSON），包含 diffRanges、wer、score 等' })
  @Expose()
  auditResult!: any;

  @ApiProperty()
  @Expose()
  isActive!: boolean;

  @ApiProperty()
  @Expose()
  version!: number;

  @ApiProperty({ description: '处理状态: uploaded → parsed → chunked → embedded → indexed' })
  @Expose()
  processStatus!: string;

  @ApiProperty({ description: '质量评分 0-100（null=未检查）' })
  @Expose()
  qualityScore!: number | null;

  @ApiProperty({ description: '质量标记（逗号分隔）' })
  @Expose()
  qualityFlags!: string | null;

  @ApiProperty()
  @Expose()
  createdAt!: Date;

  @ApiProperty()
  @Expose()
  updatedAt!: Date;
}

export class RagDocListResponseDto extends PaginatedResponseDto<RagDocResponseDto> {
  @ApiProperty({ type: [RagDocResponseDto] })
  declare list: RagDocResponseDto[];
}
