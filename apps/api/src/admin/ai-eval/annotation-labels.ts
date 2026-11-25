/**
 * 标注相关的共享常量与类型。
 *
 * 标注只保留「是否解决」与备注：1-5 的 helpfulness/tone_safety 已删除，
 * 它们既不参与任何指标，也无法与判官结论对齐。
 */

export type AnnotationCorrectness =
  | 'solved'
  | 'partial'
  | 'unsolved'
  | 'unsafe'
  | 'abstain'
  | null;

export interface AnnotationLabels {
  correctness: AnnotationCorrectness;
  comment: string;
}

export interface PrelabelSuggestion {
  correctness: AnnotationCorrectness;
  confidence: number | null;
  guidelineVersion: string;
}

/** 预标注以固定标注者落库，与人工标注并存而不是覆盖。 */
export const PRELABEL_LABELER = 'prelabel';
export const ANNOTATION_GUIDELINE_VERSION = 'annotation-guide-v1';

/** 工作表标注不属于任何评测运行，作用域用 `worksheet:<文件名>`。 */
export function worksheetScope(worksheetName: string): string {
  return `worksheet:${worksheetName}`;
}
