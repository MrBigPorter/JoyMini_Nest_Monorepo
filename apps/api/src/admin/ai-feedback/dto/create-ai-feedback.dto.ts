import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  FEEDBACK_ERROR_TYPES,
  FeedbackErrorType,
} from '@api/common/ai/ai-feedback.service';

export class CreateAiFeedbackDto {
  @IsString()
  @IsNotEmpty()
  conversationId!: string;

  @IsOptional()
  @IsString()
  messageId?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsIn(['correct', 'incorrect'])
  verdict!: 'correct' | 'incorrect';

  @IsOptional()
  @IsIn(FEEDBACK_ERROR_TYPES as unknown as string[])
  errorType?: FeedbackErrorType;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
