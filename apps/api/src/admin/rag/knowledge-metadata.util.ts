/**
 * 知识库元数据合并规则（单一事实来源）
 * ============================================================
 * 背景：#87 N-1 导入后发现 26 篇标题被加了 " (domain)" 后缀，
 * size-guide 的 domain 从 product 变成 user，vip-benefits 的
 * contentType 从 policy 变成 how-to —— 根因是 uploadFile 里
 * 注释写「frontmatter 优先」，代码却是 overrides 优先。
 *
 * 本文件把规则收敛成一个纯函数：
 *   字段优先级：frontmatter（.md 文件头） > overrides（前端弹窗） > 默认值
 *
 * 为什么保留 overrides？
 *   PDF 没有 frontmatter，它的一切元数据只能来自 overrides。
 *   所以 overrides 不是"覆盖"，而是"补缺"。
 * ============================================================
 */

/** 前端上传弹窗可填写的字段（全部可选，留空即不传） */
export interface KnowledgeMetadataOverrides {
  domain?: string;
  locale?: string;
  keywords?: string;
  contentType?: string;
  priority?: string;
}

/** 提取器（MarkdownExtractor / PdfExtractor）的输出 */
export interface ExtractedKnowledgeMetadata {
  /** 提取器已保证非空：frontmatter.title 或文件名去后缀 */
  title: string;
  /** .md 为 frontmatter 解析结果；.pdf 为 {} */
  metadata: Record<string, unknown>;
}

export interface MergedKnowledgeMetadata {
  title: string;
  domain: string;
  locale: string;
  contentType: string;
  priority: string;
  keywords: string[];
}

/** 取第一个非空字符串（空串 / 纯空白 / undefined 都算缺失） */
function firstNonEmpty(
  values: Array<string | undefined | null>,
): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return undefined;
}

/** 从 metadata 中安全读字符串字段（非字符串一律视为缺失） */
function metadataString(
  metadata: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = metadata[key];
  return typeof value === 'string' ? value : undefined;
}

/** frontmatter 的 keywords 解析器输出数组；非数组视为缺失 */
function metadataKeywords(metadata: Record<string, unknown>): string[] {
  const value = metadata.keywords;
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item).trim())
    .filter((item) => item.length > 0);
}

/**
 * 合并知识库文档元数据。
 *
 * 每个字段独立判断，互不影响：
 *   - .md 文件：frontmatter 有值就用文件里的，用户填的被忽略
 *   - .pdf 文件：metadata 为空，全部回落到 overrides
 *   - 两者都没有：用代码默认值
 *
 * 注意：title 永远不拼接任何后缀。历史版本曾拼 `${title} (${domain})`，
 * 那会让同一篇文档在重传时标题不断变化，且污染检索结果里的引用标题。
 */
export function mergeKnowledgeMetadata(
  extracted: ExtractedKnowledgeMetadata,
  overrides?: KnowledgeMetadataOverrides,
): MergedKnowledgeMetadata {
  const metadata = extracted.metadata ?? {};

  const keywordsFromFrontmatter = metadataKeywords(metadata);
  const keywordsFromOverrides =
    typeof overrides?.keywords === 'string' && overrides.keywords.trim() !== ''
      ? overrides.keywords
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      : [];

  return {
    title: (extracted.title ?? '').trim(),
    domain:
      firstNonEmpty([metadataString(metadata, 'domain'), overrides?.domain]) ??
      'general',
    locale:
      firstNonEmpty([metadataString(metadata, 'locale'), overrides?.locale]) ??
      'en',
    contentType:
      firstNonEmpty([
        metadataString(metadata, 'contentType'),
        overrides?.contentType,
      ]) ?? 'policy',
    priority:
      firstNonEmpty([metadataString(metadata, 'priority'), overrides?.priority]) ??
      'P2',
    keywords:
      keywordsFromFrontmatter.length > 0
        ? keywordsFromFrontmatter
        : keywordsFromOverrides,
  };
}
