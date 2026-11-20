import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  FEEDBACK_ERROR_TYPES,
  FEEDBACK_FAILURE_KINDS,
  FEEDBACK_RESOLUTIONS,
  FeedbackErrorType,
  FeedbackFailureKind,
  FeedbackResolution,
  FeedbackVerdict,
} from '@api/common/ai/ai-feedback.service';

export class UpdateAiFeedbackDto {
  @IsOptional()
  @IsIn(['PENDING', 'REVIEWED', 'IGNORED'])
  reviewStatus?: 'PENDING' | 'REVIEWED' | 'IGNORED';

  @IsOptional()
  @IsIn(FEEDBACK_RESOLUTIONS as unknown as string[])
  resolution?: FeedbackResolution;

  @IsOptional()
  @IsIn(FEEDBACK_FAILURE_KINDS as unknown as string[])
  failureKind?: FeedbackFailureKind;

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

  @IsOptional()
  @IsString()
  @MaxLength(32)
  ownerAdminId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  linkedEvalCaseId?: string;
}
