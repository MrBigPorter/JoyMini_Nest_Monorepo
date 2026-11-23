import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginateDto } from '@api/common/dto/paginate.dto';

export const KB_CANDIDATE_KINDS = [
  'INTENT_EXAMPLE',
  'KEYWORD',
  'GOLDEN_QUERY',
  'DOMAIN_DESCRIPTION',
] as const;

export const KB_CANDIDATE_STATUSES = [
  'PENDING',
  'APPROVED',
  'APPLIED',
  'AUTO_APPLIED',
  'REJECTED',
  'SUPERSEDED',
  'FAILED',
  'ROLLED_BACK',
] as const;

export class ListKbCandidatesDto extends PaginateDto {
  @IsOptional()
  @IsIn(KB_CANDIDATE_KINDS)
  @ApiPropertyOptional({ enum: KB_CANDIDATE_KINDS })
  kind?: (typeof KB_CANDIDATE_KINDS)[number];

  @IsOptional()
  @IsIn(KB_CANDIDATE_STATUSES)
  @ApiPropertyOptional({ enum: KB_CANDIDATE_STATUSES })
  status?: (typeof KB_CANDIDATE_STATUSES)[number];

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ description: 'Target domain filter' })
  targetDomain?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ description: 'Source document ID' })
  documentId?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ description: 'Text search (ILIKE)' })
  search?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  @ApiPropertyOptional({ description: 'Only items flagged for human review' })
  needsReview?: boolean;
}

export class ApproveKbCandidateDto {
  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    description: 'Override the target intent domain before applying',
  })
  targetDomain?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  @ApiPropertyOptional({ description: 'Override candidate text (last edit)' })
  text?: string;
}

export class RejectKbCandidateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @ApiProperty({ description: 'Rejection reason (required, audited)' })
  reason!: string;
}

export class RetargetKbCandidateDto {
  @IsString()
  @ApiProperty({ description: 'New target intent domain' })
  targetDomain!: string;
}

export class BatchKbCandidatesDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @ApiProperty({ description: 'Candidate IDs (same kind, at most 50)' })
  ids!: string[];

  @IsIn(['approve', 'reject'])
  @ApiProperty({ enum: ['approve', 'reject'] })
  action!: 'approve' | 'reject';

  @IsBoolean()
  @ApiProperty({ description: 'Must be true to execute the batch' })
  confirm!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @ApiPropertyOptional({ description: 'Reason (required for reject)' })
  reason?: string;

  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({
    description: 'Allow a >10% growth of a domain example set',
    default: false,
  })
  allowDomainGrowth?: boolean;

  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({
    description: 'Include candidates flagged needsReview (default skip)',
    default: false,
  })
  includeNeedsReview?: boolean;
}
