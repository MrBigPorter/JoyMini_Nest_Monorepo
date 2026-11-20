import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class QueueActionDto {
  @IsString()
  queueName!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  grace?: number;

  /** 是否同时清理失败任务；默认 false，仅清理已完成任务。 */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  includeFailed?: boolean;
}
