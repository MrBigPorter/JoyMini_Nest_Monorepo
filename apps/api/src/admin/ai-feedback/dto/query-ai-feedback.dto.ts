import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  FEEDBACK_ERROR_TYPES,
  FeedbackErrorType,
  FeedbackSignal,
  FeedbackSource,
} from '@api/common/ai/ai-feedback.service';

export class QueryAiFeedbackDto {
  @IsOptional()
  @IsIn(['explicit', 'implicit'])
  source?: FeedbackSource;

  @IsOptional()
  @IsIn(['transferred', 'repeated_question', 'abandoned'])
  signal?: FeedbackSignal;

  @IsOptional()
  @IsIn(FEEDBACK_ERROR_TYPES as unknown as string[])
  errorType?: FeedbackErrorType;

  @IsOptional()
  @IsIn(['PENDING', 'REVIEWED', 'IGNORED'])
  reviewStatus?: 'PENDING' | 'REVIEWED' | 'IGNORED';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
