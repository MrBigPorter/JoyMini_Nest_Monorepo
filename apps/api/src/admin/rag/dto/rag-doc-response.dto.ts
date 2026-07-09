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

  @ApiProperty({ description: '原始文件内容（buffer 转文本），用于双栏对比审核' })
  @Expose()
  rawContent!: string | null;

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
