import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class CreateEvalDatasetDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class EvalCaseDto {
  @IsString()
  question!: string;

  @IsString()
  answer!: string;

  @IsOptional()
  expect?: Record<string, any>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class AddEvalCasesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EvalCaseDto)
  cases!: EvalCaseDto[];
}

export class StartEvalRunDto {
  /** STORED（历史回答，默认） | LIVE（实时调用 AI 客服） */
  @IsOptional()
  @IsIn(['STORED', 'LIVE'])
  mode?: 'STORED' | 'LIVE';

  /** 对比基线：同一评测集内的已完成运行 */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  baselineRunId?: string;
}
