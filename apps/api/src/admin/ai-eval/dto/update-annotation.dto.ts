import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const ANNOTATION_CORRECTNESS = [
  'solved',
  'partial',
  'unsolved',
  'unsafe',
  'abstain',
] as const;

export class UpdateAnnotationDto {
  @IsOptional()
  @IsIn(ANNOTATION_CORRECTNESS as unknown as string[])
  correctness?: (typeof ANNOTATION_CORRECTNESS)[number] | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  helpfulness?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  tone_safety?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
