import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { EVAL_RUN_RESULTS_LIMITS } from './eval-input.validators';

/** 判官尝试只读查询：按运行分页，可按用例收窄。 */
export class JudgeAttemptQueryDto {
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

  @IsOptional()
  @IsString()
  @MaxLength(64)
  caseId?: string;
}
