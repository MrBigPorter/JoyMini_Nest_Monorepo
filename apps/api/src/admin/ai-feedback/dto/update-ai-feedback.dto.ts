import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  FEEDBACK_ERROR_TYPES,
  FeedbackErrorType,
  FeedbackVerdict,
} from '@api/common/ai/ai-feedback.service';

export class UpdateAiFeedbackDto {
  @IsOptional()
  @IsIn(['PENDING', 'REVIEWED', 'IGNORED'])
  reviewStatus?: 'PENDING' | 'REVIEWED' | 'IGNORED';

  @IsOptional()
  @IsIn(['correct', 'incorrect'])
  verdict?: FeedbackVerdict;

  @IsOptional()
  @IsIn(FEEDBACK_ERROR_TYPES as unknown as string[])
  errorType?: FeedbackErrorType;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
