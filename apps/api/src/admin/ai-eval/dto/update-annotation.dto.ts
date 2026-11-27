import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const ANNOTATION_CORRECTNESS = [
  'solved',
  'partial',
  'unsolved',
  'unsafe',
  'abstain',
] as const;

/**
 * 标注只保留「是否解决」与备注：1-5 的 helpfulness/tone_safety
 * 既不参与任何指标，也无法和判官结论对齐，已删除。
 */
export class UpdateAnnotationDto {
  @IsOptional()
  @IsIn(ANNOTATION_CORRECTNESS as unknown as string[])
  correctness?: (typeof ANNOTATION_CORRECTNESS)[number] | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;

  /** 标注指南版本；缺省用服务端常量，便于离线脚本回填历史样本。 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  guidelineVersion?: string;
}
