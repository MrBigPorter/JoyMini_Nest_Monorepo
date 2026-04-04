import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum ReviewAction {
  APPROVE = 'approve',
  REJECT = 'reject',
}

export class ReviewApplicationDto {
  @ApiPropertyOptional({
    description: 'Rejection reason (required when rejecting)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reviewNote?: string;
}
