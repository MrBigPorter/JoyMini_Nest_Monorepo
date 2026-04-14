/**
 * 翻译质量评估工具
 */

export interface TranslationQualityMetrics {
  /** 完整性 (0-1) - 翻译是否完整 */
  completeness: number;
  /** 准确性 (0-1) - 翻译是否准确 */
  accuracy: number;
  /** 流畅度 (0-1) - 翻译是否流畅自然 */
  fluency: number;
  /** 术语一致性 (0-1) - 术语使用是否一致 */
  terminologyConsistency: number;
  /** 总体评分 (0-100) */
  overallScore: number;
  /** 问题列表 */
  issues: TranslationIssue[];
}

export interface TranslationIssue {
  type: 'missing' | 'inaccurate' | 'grammar' | 'terminology' | 'format';
  severity: 'low' | 'medium' | 'high';
  description: string;
  position?: {
    start: number;
    end: number;
  };
  suggestion?: string;
}

export interface QualityAssessmentOptions {
  /** 源语言 */
  sourceLang: string;
  /** 目标语言 */
  targetLang: string;
  /** 是否启用详细检查 (默认: true) */
  detailedCheck?: boolean;
  /** 最小置信度阈值 (0-1, 默认: 0.7) */
  minConfidence?: number;
}

/**
 * 翻译质量评估器
 */
export class TranslationQualityAssessor {
  private options: Required<QualityAssessmentOptions>;

  constructor(
    options: QualityAssessmentOptions = { sourceLang: 'zh', targetLang: 'en' },
  ) {
    this.options = {
      sourceLang: options.sourceLang,
      targetLang: options.targetLang,
      detailedCheck: options.detailedCheck ?? true,
      minConfidence: options.minConfidence ?? 0.7,
    };
  }

  /**
   * 评估单个翻译的质量
   */
  assess(
    sourceText: string,
    translatedText: string,
    context?: {
      fieldType?: 'title' | 'content' | 'excerpt' | 'tag' | 'category';
      previousTranslations?: Record<string, string>;
    },
  ): TranslationQualityMetrics {
    const issues: TranslationIssue[] = [];

    // 1. 完整性检查
    const completeness = this.checkCompleteness(
      sourceText,
      translatedText,
      issues,
    );

    // 2. 基本准确性检查
    const accuracy = this.checkAccuracy(sourceText, translatedText, issues);

    // 3. 流畅度检查
    const fluency = this.checkFluency(translatedText, issues);

    // 4. 术语一致性检查
    const terminologyConsistency = context?.previousTranslations
      ? this.checkTerminologyConsistency(
          translatedText,
          context.previousTranslations,
          issues,
        )
      : 1.0;

    // 5. 计算总体评分
    const overallScore = this.calculateOverallScore({
      completeness,
      accuracy,
      fluency,
      terminologyConsistency,
    });

    return {
      completeness,
      accuracy,
      fluency,
      terminologyConsistency,
      overallScore,
      issues,
    };
  }

  /**
   * 批量评估翻译质量
   */
  assessBatch(
    translations: Array<{
      sourceText: string;
      translatedText: string;
      fieldName?: string;
    }>,
    context?: {
      fieldType?: 'title' | 'content' | 'excerpt' | 'tag' | 'category';
    },
  ): {
    metrics: TranslationQualityMetrics;
    perItem: Array<{
      fieldName?: string;
      metrics: TranslationQualityMetrics;
    }>;
    summary: {
      totalItems: number;
      averageScore: number;
      itemsWithIssues: number;
      criticalIssues: number;
    };
  } {
    const perItemAssessments = translations.map((item) => ({
      fieldName: item.fieldName,
      metrics: this.assess(item.sourceText, item.translatedText, context),
    }));

    // 计算总体指标
    const totalItems = perItemAssessments.length;
    const totalScore = perItemAssessments.reduce(
      (sum, item) => sum + item.metrics.overallScore,
      0,
    );
    const averageScore = totalItems > 0 ? totalScore / totalItems : 0;

    // 统计问题
    let itemsWithIssues = 0;
    let criticalIssues = 0;

    perItemAssessments.forEach((item) => {
      if (item.metrics.issues.length > 0) {
        itemsWithIssues++;
        criticalIssues += item.metrics.issues.filter(
          (issue) => issue.severity === 'high',
        ).length;
      }
    });

    // 计算总体指标（平均值）
    const overallMetrics: TranslationQualityMetrics = {
      completeness:
        perItemAssessments.reduce(
          (sum, item) => sum + item.metrics.completeness,
          0,
        ) / totalItems,
      accuracy:
        perItemAssessments.reduce(
          (sum, item) => sum + item.metrics.accuracy,
          0,
        ) / totalItems,
      fluency:
        perItemAssessments.reduce(
          (sum, item) => sum + item.metrics.fluency,
          0,
        ) / totalItems,
      terminologyConsistency:
        perItemAssessments.reduce(
          (sum, item) => sum + item.metrics.terminologyConsistency,
          0,
        ) / totalItems,
      overallScore: averageScore,
      issues: perItemAssessments.flatMap((item) => item.metrics.issues),
    };

    return {
      metrics: overallMetrics,
      perItem: perItemAssessments,
      summary: {
        totalItems,
        averageScore,
        itemsWithIssues,
        criticalIssues,
      },
    };
  }

  /**
   * 检查翻译完整性
   */
  private checkCompleteness(
    sourceText: string,
    translatedText: string,
    issues: TranslationIssue[],
  ): number {
    // 简单检查：翻译是否为空
    if (!translatedText || translatedText.trim().length === 0) {
      issues.push({
        type: 'missing',
        severity: 'high',
        description: '翻译内容为空',
      });
      return 0;
    }

    // 检查长度比例（粗略估计完整性）
    const sourceLength = sourceText.trim().length;
    const translatedLength = translatedText.trim().length;

    // 不同语言的平均字符长度比例
    const lengthRatios: Record<string, Record<string, number>> = {
      zh: { en: 0.6, ja: 0.8, ko: 0.7, fr: 0.7, de: 0.7 },
      en: { zh: 1.7, ja: 0.9, ko: 1.0, fr: 1.0, de: 1.0 },
    };

    const expectedRatio =
      lengthRatios[this.options.sourceLang]?.[this.options.targetLang] ?? 1.0;
    const actualRatio = translatedLength / (sourceLength || 1);
    const ratioDiff = Math.abs(actualRatio - expectedRatio) / expectedRatio;

    if (ratioDiff > 0.5) {
      issues.push({
        type: 'missing',
        severity: ratioDiff > 1.0 ? 'high' : 'medium',
        description: `翻译长度异常: 预期比例 ${expectedRatio.toFixed(2)}, 实际比例 ${actualRatio.toFixed(2)}`,
      });
    }

    // 完整性评分 (0-1)
    const completenessScore = Math.max(0, 1 - ratioDiff * 0.5);
    return Math.min(1, completenessScore);
  }

  /**
   * 检查翻译准确性（基础检查）
   */
  private checkAccuracy(
    sourceText: string,
    translatedText: string,
    issues: TranslationIssue[],
  ): number {
    // 简单检查：是否包含明显的占位符或未翻译内容
    const placeholderPatterns = [
      /\[.*?\]/g, // [占位符]
      /\{.*?\}/g, // {占位符}
      /<.*?>/g, // <占位符>
      /TODO/i,
      /FIXME/i,
      /XXX/i,
    ];

    let accuracyScore = 1.0;

    placeholderPatterns.forEach((pattern) => {
      if (pattern.test(translatedText)) {
        issues.push({
          type: 'inaccurate',
          severity: 'medium',
          description: '翻译中包含占位符或未翻译内容',
          position: this.findPatternPosition(translatedText, pattern),
        });
        accuracyScore *= 0.8;
      }
    });

    // 检查是否包含源语言字符（对于非拉丁语系目标语言）
    const sourceLangChars = this.getLanguageCharacterSet(
      this.options.sourceLang,
    );
    const targetLangChars = this.getLanguageCharacterSet(
      this.options.targetLang,
    );

    if (
      sourceLangChars &&
      targetLangChars &&
      sourceLangChars !== targetLangChars
    ) {
      const sourceCharPattern = new RegExp(`[${sourceLangChars}]`, 'g');
      const sourceCharMatches = translatedText.match(sourceCharPattern);

      if (sourceCharMatches && sourceCharMatches.length > 0) {
        issues.push({
          type: 'inaccurate',
          severity: 'medium',
          description: `翻译中包含源语言字符 (${this.options.sourceLang})`,
        });
        accuracyScore *= 0.9;
      }
    }

    return accuracyScore;
  }

  /**
   * 检查翻译流畅度
   */
  private checkFluency(
    translatedText: string,
    issues: TranslationIssue[],
  ): number {
    // 简单检查：句子结构是否完整
    const sentences = translatedText
      .split(/[.!?]+/)
      .filter((s) => s.trim().length > 0);
    let fluencyScore = 1.0;

    // 检查句子长度
    sentences.forEach((sentence, index) => {
      const words = sentence.trim().split(/\s+/).length;

      // 异常长的句子可能有问题
      if (words > 50) {
        issues.push({
          type: 'grammar',
          severity: 'medium',
          description: `句子过长 (${words} 个单词)，可能影响可读性`,
          position: this.getSentencePosition(translatedText, index),
        });
        fluencyScore *= 0.9;
      }

      // 异常短的句子
      if (words < 3 && sentence.trim().length > 10) {
        issues.push({
          type: 'grammar',
          severity: 'low',
          description: '句子可能不完整',
          position: this.getSentencePosition(translatedText, index),
        });
        fluencyScore *= 0.95;
      }
    });

    // 检查常见的语法问题模式
    const grammarPatterns = [
      /\s{2,}/g, // 多个空格
      /\.{2,}/g, // 多个句点
      /,,/g, // 双逗号
      /;;/g, // 双分号
    ];

    grammarPatterns.forEach((pattern) => {
      if (pattern.test(translatedText)) {
        issues.push({
          type: 'format',
          severity: 'low',
          description: '文本格式问题',
          position: this.findPatternPosition(translatedText, pattern),
        });
        fluencyScore *= 0.95;
      }
    });

    return fluencyScore;
  }

  /**
   * 检查术语一致性
   */
  private checkTerminologyConsistency(
    translatedText: string,
    previousTranslations: Record<string, string>,
    issues: TranslationIssue[],
  ): number {
    // 简单实现：检查常见术语是否一致
    // 在实际应用中，这里应该使用术语库

    const commonTerms = this.extractPotentialTerms(translatedText);
    let consistencyScore = 1.0;

    // 检查每个术语是否在之前的翻译中出现过
    commonTerms.forEach((term) => {
      // 在实际应用中，这里应该查询术语库
      // 这里只是示例
      const termVariations = this.getTermVariations(term);
      const hasConsistentTranslation = termVariations.some((variation) =>
        Object.values(previousTranslations).some((text) =>
          text.toLowerCase().includes(variation.toLowerCase()),
        ),
      );

      if (!hasConsistentTranslation && term.length > 3) {
        issues.push({
          type: 'terminology',
          severity: 'low',
          description: `术语 "${term}" 可能需要一致性检查`,
        });
        consistencyScore *= 0.95;
      }
    });

    return consistencyScore;
  }

  /**
   * 计算总体评分
   */
  private calculateOverallScore(metrics: {
    completeness: number;
    accuracy: number;
    fluency: number;
    terminologyConsistency: number;
  }): number {
    // 加权平均
    const weights = {
      completeness: 0.3,
      accuracy: 0.4,
      fluency: 0.2,
      terminologyConsistency: 0.1,
    };

    const weightedSum =
      metrics.completeness * weights.completeness +
      metrics.accuracy * weights.accuracy +
      metrics.fluency * weights.fluency +
      metrics.terminologyConsistency * weights.terminologyConsistency;

    // 转换为 0-100 分
    return Math.round(weightedSum * 100);
  }

  /**
   * 提取潜在术语
   */
  private extractPotentialTerms(text: string): string[] {
    // 简单实现：提取大写单词和长单词作为潜在术语
    const words = text.split(/\s+/);
    return words.filter((word) => {
      // 大写单词（首字母大写）
      if (/^[A-Z][a-z]+$/.test(word)) return true;

      // 长单词（可能是有意义的术语）
      if (word.length >= 8) return true;

      // 包含数字或特殊字符的单词
      if (/[0-9_\-]/.test(word)) return true;

      return false;
    });
  }

  /**
   * 获取术语的变体
   */
  private getTermVariations(term: string): string[] {
    const variations = [term];

    // 添加小写版本
    variations.push(term.toLowerCase());

    // 添加单数/复数变体（简单英语）
    if (term.endsWith('s')) {
      variations.push(term.slice(0, -1));
    } else {
      variations.push(term + 's');
    }

    return variations;
  }

  /**
   * 获取语言字符集
   */
  private getLanguageCharacterSet(lang: string): string | null {
    const charSets: Record<string, string> = {
      zh: '\\u4e00-\\u9fff', // 中文汉字
      ja: '\\u3040-\\u309f\\u30a0-\\u30ff\\u4e00-\\u9fff', // 日文
      ko: '\\uac00-\\ud7af', // 韩文
      // 拉丁语系使用基本相同的字符集
      en: 'a-zA-Z',
      fr: 'a-zA-Zàâäèéêëîïôöùûüç',
      de: 'a-zA-Zäöüß',
    };

    return charSets[lang] || null;
  }

  /**
   * 查找模式在文本中的位置
   */
  private findPatternPosition(
    text: string,
    pattern: RegExp,
  ): { start: number; end: number } | undefined {
    const match = pattern.exec(text);
    if (match) {
      return {
        start: match.index,
        end: match.index + match[0].length,
      };
    }
    return undefined;
  }

  /**
   * 获取句子位置
   */
  private getSentencePosition(
    text: string,
    sentenceIndex: number,
  ): { start: number; end: number } | undefined {
    const sentences = text.split(/([.!?]+)/);
    let currentPos = 0;
    let currentSentence = 0;

    for (let i = 0; i < sentences.length; i += 2) {
      const sentence = sentences[i];
      const punctuation = sentences[i + 1] || '';

      if (currentSentence === sentenceIndex) {
        return {
          start: currentPos,
          end: currentPos + sentence.length,
        };
      }

      currentPos += sentence.length + punctuation.length;
      currentSentence++;
    }

    return undefined;
  }
}

/**
 * 创建翻译质量评估报告
 */
export function createQualityReport(
  metrics: TranslationQualityMetrics,
  options?: {
    includeDetails?: boolean;
    format?: 'text' | 'html' | 'json';
  },
): string {
  const format = options?.format || 'text';
  const includeDetails = options?.includeDetails ?? true;

  if (format === 'json') {
    return JSON.stringify(metrics, null, 2);
  }

  let report = '';

  if (format === 'html') {
    report += `<div class="translation-quality-report">`;
    report += `<h3>翻译质量评估报告</h3>`;
    report += `<div class="overall-score">总体评分: <strong>${metrics.overallScore}/100</strong></div>`;
    report += `<div class="metrics">`;
    report += `<div>完整性: ${Math.round(metrics.completeness * 100)}%</div>`;
    report += `<div>准确性: ${Math.round(metrics.accuracy * 100)}%</div>`;
    report += `<div>流畅度: ${Math.round(metrics.fluency * 100)}%</div>`;
    report += `<div>术语一致性: ${Math.round(metrics.terminologyConsistency * 100)}%</div>`;
    report += `</div>`;

    if (includeDetails && metrics.issues.length > 0) {
      report += `<div class="issues">`;
      report += `<h4>发现的问题 (${metrics.issues.length} 个)</h4>`;
      report += `<ul>`;
      metrics.issues.forEach((issue, index) => {
        report += `<li class="issue severity-${issue.severity}">`;
        report += `<strong>[${issue.type.toUpperCase()}]</strong> ${issue.description}`;

        if (issue.suggestion) {
          report += `<br/><small>建议: ${issue.suggestion}</small>`;
        }

        report += `</li>`;
      });
      report += `</ul>`;
      report += `</div>`;
    }

    report += `</div>`;
    return report;
  } else {
    // Text format
    report += `翻译质量评估报告\n`;
    report += `================\n`;
    report += `总体评分: ${metrics.overallScore}/100\n\n`;
    report += `详细指标:\n`;
    report += `- 完整性: ${Math.round(metrics.completeness * 100)}%\n`;
    report += `- 准确性: ${Math.round(metrics.accuracy * 100)}%\n`;
    report += `- 流畅度: ${Math.round(metrics.fluency * 100)}%\n`;
    report += `- 术语一致性: ${Math.round(metrics.terminologyConsistency * 100)}%\n`;

    if (includeDetails && metrics.issues.length > 0) {
      report += `\n发现的问题 (${metrics.issues.length} 个):\n`;
      metrics.issues.forEach((issue, index) => {
        report += `${index + 1}. [${issue.type.toUpperCase()}] ${issue.severity.toUpperCase()}: ${issue.description}`;
        if (issue.suggestion) {
          report += ` (建议: ${issue.suggestion})`;
        }
        report += `\n`;
      });
    }

    return report;
  }
}

/**
 * 快速评估翻译质量（简化版）
 */
export function quickAssessTranslation(
  sourceText: string,
  translatedText: string,
  sourceLang: string = 'zh',
  targetLang: string = 'en',
): { score: number; hasIssues: boolean; issues: string[] } {
  const assessor = new TranslationQualityAssessor({ sourceLang, targetLang });
  const metrics = assessor.assess(sourceText, translatedText);

  return {
    score: metrics.overallScore,
    hasIssues: metrics.issues.length > 0,
    issues: metrics.issues.map(
      (issue) => `${issue.type}: ${issue.description}`,
    ),
  };
}

/**
 * 获取翻译质量等级
 */
export function getQualityLevel(
  score: number,
): 'excellent' | 'good' | 'fair' | 'poor' {
  if (score >= 90) return 'excellent';
  if (score >= 75) return 'good';
  if (score >= 60) return 'fair';
  return 'poor';
}

/**
 * 生成质量摘要
 */
export function generateQualitySummary(
  metrics: TranslationQualityMetrics,
): string {
  const level = getQualityLevel(metrics.overallScore);
  const levelNames = {
    excellent: '优秀',
    good: '良好',
    fair: '一般',
    poor: '较差',
  };

  return `翻译质量${levelNames[level]} (${metrics.overallScore}/100)，发现 ${metrics.issues.length} 个问题`;
}
