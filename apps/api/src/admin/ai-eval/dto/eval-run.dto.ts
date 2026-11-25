import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { EVAL_RUN_RESULTS_LIMITS } from './eval-input.validators';

/**
 * 运行结果分页参数。`pageSize` 上限由 spec 固定为 200，
 * 超过时由校验直接返回 400，不做静默截断。
 */
export class RunResultsQueryDto {
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
