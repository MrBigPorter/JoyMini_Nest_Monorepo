import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { EVAL_CASE_LIMITS } from './eval-input.validators';

export const ANSWER_VERDICTS = ['correct', 'incorrect', 'judge_error'] as const;
export const GROUNDING_KINDS = [
  'kb',
  'tool',
  'none',
  'fallback',
  'unknown',
] as const;
export const JUDGE_ERROR_KINDS = [
  'auth',
  'rate_limit',
  'timeout',
  'output_format',
  'policy',
  /**
   * 以下两类不是「判官失败」，而是「这条用例不参与答案准确性」：
   * - harness：harness 自己没跑完（断线/超时/配额）
   * - not_applicable：该用例判的是任务完成度或安全断言，不是答案准确性
   * Phase 2 的指标规范会把它们从 judgeErrorRate 的分子里排除。
   */
  'harness',
  'not_applicable',
] as const;

/**
 * 真正算「判官失败」的类型；`harness` / `not_applicable` 不是判官失败，
 * 不计入 judgeErrorRate 的分子与分母（见 tools/eval/e2e/METRICS.md）。
 */
export const JUDGE_FAILURE_KINDS = [
  'auth',
  'rate_limit',
  'timeout',
  'output_format',
  'policy',
] as const;

export type AnswerVerdict = (typeof ANSWER_VERDICTS)[number];
export type GroundingKind = (typeof GROUNDING_KINDS)[number];
export type JudgeErrorKind = (typeof JUDGE_ERROR_KINDS)[number];

/** 运行开始时的单条用例快照；只保留评测需要的字段。 */
export class ExternalEvalCaseSnapshotDto {
  @IsString()
  @MaxLength(64)
  caseId!: string;

  /** 用例分型（kb / tool / smalltalk ...），仅用于报告分组。 */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  kind?: string;

  @IsString()
  @MaxLength(8000)
  question!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  expectedDocIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(8)
  lang?: string;
}

export class CreateExternalRunDto {
  /**
   * 用例集指纹（sha256 前 16 位或同等稳定值）。
   * 服务端按它物化 / 复用 e2e:<fingerprint> 数据集。
   */
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{4,64}$/, {
    message: 'datasetFingerprint must be 4-64 chars of [A-Za-z0-9._-]',
  })
  datasetFingerprint!: string;

  @IsArray()
  @ArrayMaxSize(EVAL_CASE_LIMITS.resultBatch)
  @ValidateNested({ each: true })
  @Type(() => ExternalEvalCaseSnapshotDto)
  cases!: ExternalEvalCaseSnapshotDto[];

  /** 代码版本（git sha） */
  @IsString()
  @MaxLength(64)
  codeVersion!: string;

  /** 依据门禁模式（enforce / shadow / off ...） */
  @IsString()
  @MaxLength(32)
  gateMode!: string;

  /** 判官输入规范版本 */
  @IsString()
  @MaxLength(32)
  judgeSpecVersion!: string;

  /** 指标定义版本 */
  @IsString()
  @MaxLength(32)
  metricSpecVersion!: string;

  /** 运行范围：全量或受影响子集；子集不得 promote */
  @IsOptional()
  @IsIn(['full', 'subset'])
  scope?: 'full' | 'subset';

  /** harness 开跑前读到的语料指纹（与服务端比对稳定性） */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  knowledgeFingerprintBefore?: string;

  /**
   * 可选对比基线：同一数据集内已完成的 run。
   * 不传 = 回退到当前已登记基线；显式传 null = 本次不对比（不回退）。
   */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  baselineRunId?: string | null;
}

export class ExternalEvalResultDto {
  /** 快照中声明的 caseId（不是数据库主键） */
  @IsString()
  @MaxLength(64)
  caseId!: string;

  @IsIn(ANSWER_VERDICTS as unknown as string[])
  answerVerdict!: AnswerVerdict;

  /** 0-1；缺省时 correct=1、incorrect=0、judge_error=0 */
  @IsOptional()
  @IsNumber()
  @Min(0)
  answerScore?: number;

  /** 必填：判官理由或失败原因，报告与抽检都用它 */
  @IsString()
  @MaxLength(4000)
  reason!: string;

  @IsOptional()
  @IsIn(GROUNDING_KINDS as unknown as string[])
  grounding?: GroundingKind;

  /** answerVerdict=judge_error 时必填（service 层校验） */
  @IsOptional()
  @IsIn(JUDGE_ERROR_KINDS as unknown as string[])
  judgeErrorKind?: JudgeErrorKind;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  judgeInputHash?: string;

  /**
   * 判官重复采样的稳定性证据（metric spec v3）。
   * 只有 `judgeSuccessfulAttempts >= 2` 的用例进入 judgeAgreement 分母；
   * 这些字段不落 AiEvalResult 列，只用于计算 run summary。
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  judgeAgreement?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  judgeSuccessfulAttempts?: number;

  @IsOptional()
  @IsBoolean()
  judgeDisagreement?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  traceId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  latencyMs?: number;
}

export class IngestExternalResultsDto {
  @IsArray()
  @ArrayMaxSize(EVAL_CASE_LIMITS.resultBatch)
  @ValidateNested({ each: true })
  @Type(() => ExternalEvalResultDto)
  cases!: ExternalEvalResultDto[];

  /** 收尾状态；默认 COMPLETED。FAILED 时只落 error，不写结果。 */
  @IsOptional()
  @IsIn(['COMPLETED', 'FAILED'])
  status?: 'COMPLETED' | 'FAILED';

  @IsOptional()
  @IsString()
  @MaxLength(300)
  error?: string;

  /** harness 开跑前 / 收尾前的语料指纹；用于与服务端两次读数比对稳定性 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  knowledgeFingerprintBefore?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  knowledgeFingerprintAfter?: string;
}
