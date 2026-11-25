import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { EVAL_RUN_RESULTS_LIMITS } from './eval-input.validators';

/**
 * 运行结果 / 数据集用例共用的分页参数。`pageSize` 上限由 spec 固定为 200，
 * 超过时由校验直接返回 400，不做静默截断。
 */
export class EvalPageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(EVAL_RUN_RESULTS_LIMITS.maxPageSize)
  pageSize?: number;
}

/** 单用例时间线：必须显式给出 caseId，避免误把整次运行当时间线。 */
export class EvalCaseHistoryQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  caseId!: string;
}

/** 两次运行差异：不传时回退到 run.baselineRunId。 */
export class EvalRunDiffQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  baselineRunId?: string;
}
