import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { EVAL_CASE_LIMITS, IsEvalExpectation } from './eval-input.validators';

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
  @MaxLength(EVAL_CASE_LIMITS.question)
  question!: string;

  @IsString()
  @MaxLength(EVAL_CASE_LIMITS.answer)
  answer!: string;

  @IsOptional()
  @IsEvalExpectation()
  expect?: Record<string, any>;

  /** 期望答案/要点；与 expect 二选一，至少有一个非空。 */
  @IsOptional()
  @IsEvalExpectation()
  expected?: string | Record<string, any>;

  @IsOptional()
  metadata?: Record<string, any>;

  /** 来源反馈；从质量待办生成时写入。 */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  sourceFeedbackId?: string;

  /** 来源：feedback / manual / import */
  @IsOptional()
  @IsString()
  @MaxLength(16)
  source?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(EVAL_CASE_LIMITS.tags)
  @IsString({ each: true })
  @MaxLength(EVAL_CASE_LIMITS.tagLength, { each: true })
  tags?: string[];
}

export class UpdateEvalCaseDto {
  @IsOptional()
  @IsString()
  @MaxLength(EVAL_CASE_LIMITS.question)
  question?: string;

  @IsOptional()
  @IsString()
  @MaxLength(EVAL_CASE_LIMITS.answer)
  answer?: string;

  @IsOptional()
  @IsEvalExpectation()
  expect?: Record<string, any>;

  @IsOptional()
  @IsEvalExpectation()
  expected?: string | Record<string, any>;

  @IsOptional()
  metadata?: Record<string, any>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(EVAL_CASE_LIMITS.tags)
  @IsString({ each: true })
  @MaxLength(EVAL_CASE_LIMITS.tagLength, { each: true })
  tags?: string[];
}

export class AddEvalCasesDto {
  @IsArray()
  @ArrayMaxSize(EVAL_CASE_LIMITS.caseBatch)
  @ValidateNested({ each: true })
  @Type(() => EvalCaseDto)
  cases!: EvalCaseDto[];
}

export class StartEvalRunDto {
  /** STORED（历史回答，默认） | LIVE（实时调用 AI 客服） */
  @IsOptional()
  @IsIn(['STORED', 'LIVE'])
  mode?: 'STORED' | 'LIVE';

  /**
   * 对比基线：同一评测集内的已完成运行。
   * 不传 = 回退到当前已登记基线；显式传 null = 本次不对比（不回退）。
   */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  baselineRunId?: string | null;
}
