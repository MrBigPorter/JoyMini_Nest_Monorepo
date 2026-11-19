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

  @ApiProperty({ description: '检索来源', type: [JudgeSourceDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => JudgeSourceDto)
  sources!: JudgeSourceDto[];
}
