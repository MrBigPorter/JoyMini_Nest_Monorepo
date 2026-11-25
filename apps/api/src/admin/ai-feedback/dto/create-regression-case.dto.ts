import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateRegressionCaseDto {
  /** 目标评测集；e2e: 只读数据集会被服务端拒绝。 */
  @IsString()
  @MaxLength(32)
  datasetId!: string;

  /** 期望答案 / 必须提到的要点；加入回归时必填，作为判分标准。 */
  @IsString()
  @MaxLength(500)
  expected!: string;

  /** 前端读到的反馈版本；不一致说明别人先改了，返回 409。 */
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedVersion?: number;
}
