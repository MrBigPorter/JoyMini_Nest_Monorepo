import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
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

  /** 前端读到的 version；不一致说明别人先改了，服务端返回 409。 */
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedVersion?: number;

  /** 已被他人认领时，显式接手才允许改写负责人。 */
  @IsOptional()
  @IsBoolean()
  takeOver?: boolean;
}
