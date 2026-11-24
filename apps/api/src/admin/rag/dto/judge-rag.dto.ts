import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class JudgeSourceDto {
  @ApiPropertyOptional({ description: '来源标题', example: 'Refund Policy' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({
    description: '知识库 docId',
    example: 'refund-policy',
  })
  @IsOptional()
  @IsString()
  docId?: string;

  @ApiProperty({ description: '来源片段内容' })
  @IsString()
  content!: string;
}

/** LLM-as-Judge：判断回答是否被 sources 支持 */
export class JudgeRagDto {
  @ApiProperty({ description: '用户问题' })
  @IsString()
  @IsNotEmpty()
  question!: string;

  @ApiProperty({ description: '待评估的 AI 回答' })
  @IsString()
  @IsNotEmpty()
  answer!: string;

  @ApiPropertyOptional({
    description:
      '检索来源。传了就按传入的 sources 判（兼容旧调用方）；不传则按 expectedDocIds/citedDocIds 由服务端取 chunk。',
    type: [JudgeSourceDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => JudgeSourceDto)
  sources?: JudgeSourceDto[];

  @ApiPropertyOptional({
    description: 'golden 文档 docId；未传 sources 时由服务端按 docId 取 chunk',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  expectedDocIds?: string[];

  @ApiPropertyOptional({
    description: '回答实际引用的文档 docId；未传 sources 时作为补充来源',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  citedDocIds?: string[];
}
