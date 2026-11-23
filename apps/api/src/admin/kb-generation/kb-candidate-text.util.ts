import { createHash } from 'node:crypto';

/**
 * 候选文本规范化：小写、折叠空白、去首尾。
 * 只用于去重与指纹，不用于展示或写库正文。
 */
export function normalizeCandidateText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function hashCandidateText(text: string): string {
  return createHash('sha256')
    .update(normalizeCandidateText(text), 'utf8')
    .digest('hex');
}

/** 生成幂等键：documentId + version + contentHash（或文档内容指纹） */
export function buildGenerationIdempotencyKey(
  documentId: string,
  version: number,
  contentHash: string,
): string {
  return createHash('sha256')
    .update(`${documentId}:${version}:${contentHash}`, 'utf8')
    .digest('hex');
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
