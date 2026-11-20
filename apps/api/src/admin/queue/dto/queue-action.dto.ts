import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class QueueActionDto {
  @IsString()
  queueName!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  grace?: number;
}
