import { Injectable, Logger } from '@nestjs/common';
import { diffChars, Change } from 'diff';
import { AiService } from '@api/common/ai/ai.service';

// =============================================================================
// DiffRange — 双源对撞差异范围
// =============================================================================

export interface DiffRange {
  type: 'equal' | 'added' | 'removed';
  value: string;
  count?: number;
  severity?: 'critical' | 'minor' | 'ignore';
}

export interface NumberError {
  raw: string;
  parsed: string;
  index: number;
  severity: 'critical';
}

export interface DiffResult {
  contentMatch: boolean;
  diffRanges: DiffRange[];
  numberErrors: NumberError[];
  wer: number;
}

// =============================================================================
// QualityCheckResult — 启发式质量检查结果
// =============================================================================

export interface QualityCheckResult {
  passed: boolean;
  overallScore: number;
  checks: {
    truncation: { passed: boolean; detail: string };
    retentionRate: { passed: boolean; rate: number; detail: string };
    encoding: { passed: boolean; detail: string };
    emptyContent: { passed: boolean; detail: string };
  };
  flags: string[];
}

// =============================================================================
// DiffAuditResult — LLM Diff 审计结果
// =============================================================================

export interface DiffAuditResult {
  selected: 'A' | 'B';
  selectedContent: string;
  score: number;
  reasoning: string;
  issues: string[];
  verdict: 'approved' | 'needs_review';
}

// =============================================================================
// RagQualityService
// =============================================================================

@Injectable()
export class RagQualityService {
  private readonly logger = new Logger(RagQualityService.name);

  constructor(private readonly aiService: AiService) {}

  check(content: string, fileSizeBytes: number): QualityCheckResult {
    const truncation = this.checkTruncation(content);
    const retentionRate = this.checkRetentionRate(content, fileSizeBytes);
    const encoding = this.checkEncoding(content);
    const emptyContent = this.checkEmptyContent(content);

    const allChecks = [truncation, retentionRate, encoding, emptyContent];
    const passedCount = allChecks.filter((c) => c.passed).length;
    const overallScore = Math.round((passedCount / 4) * 100);

    const flags: string[] = [];
    if (!truncation.passed) flags.push('truncation');
    if (!retentionRate.passed) flags.push('low_retention');
    if (!encoding.passed) flags.push('encoding_issue');
    if (!emptyContent.passed) flags.push('empty_content');

    return {
      passed: overallScore >= 75,
      overallScore,
      checks: { truncation, retentionRate, encoding, emptyContent },
      flags,
    };
  }

  // ──────────── 规则 1: 截断检测 ────────────

  private checkTruncation(content: string): { passed: boolean; detail: string } {
    if (content.length < 100) {
      return { passed: true, detail: 'Content too short for truncation check' };
    }
    const tail = content.slice(-200);
    const isComplete = /[.!?。！？)\n]\s*$/.test(tail);
    return {
      passed: isComplete,
      detail: isComplete
        ? 'Content ends with a complete sentence'
        : 'Content may be truncated (no sentence-ending punctuation at the end)',
    };
  }

  // ──────────── 规则 2: 字符保留率 ────────────

  private checkRetentionRate(
    content: string,
    fileSizeBytes: number,
  ): { passed: boolean; rate: number; detail: string } {
    if (fileSizeBytes <= 0) {
      return { passed: false, rate: 0, detail: 'File size is zero' };
    }
    const rate = content.length / fileSizeBytes;
    if (rate < 0.01) {
      return {
        passed: false,
        rate: Math.round(rate * 10000) / 100,
        detail: `Very low retention (${(rate * 100).toFixed(2)}%): file may be unreadable or a scanned image`,
      };
    }
    if (rate > 0.8) {
      return {
        passed: true,
        rate: Math.round(rate * 10000) / 100,
        detail: `High retention (${(rate * 100).toFixed(1)}%): file appears to be plain text`,
      };
    }
    return {
      passed: true,
      rate: Math.round(rate * 10000) / 100,
      detail: `Normal retention (${(rate * 100).toFixed(1)}%)`,
    };
  }

  // ──────────── 规则 3: 编码检测 ────────────

  private checkEncoding(content: string): { passed: boolean; detail: string } {
    if (content.length === 0) {
      return { passed: true, detail: 'Empty content, skipping encoding check' };
    }
    const garbageMatches = content.match(/[�\x00-\x08\x0B\x0C\x0E-\x1F]/g);
    const garbageCount = garbageMatches ? garbageMatches.length : 0;
    const garbageRatio = garbageCount / content.length;
    if (garbageRatio >= 0.01) {
      return {
        passed: false,
        detail: `Encoding issues detected (${(garbageRatio * 100).toFixed(1)}% of characters are replacement/control chars)`,
      };
    }
    return {
      passed: true,
      detail: garbageCount > 0
        ? `Minor encoding artifacts (${garbageCount} char(s), ${(garbageRatio * 100).toFixed(2)}%)`
        : 'No encoding issues detected',
    };
  }

  // ──────────── 规则 4: 空内容检测 ────────────

  private checkEmptyContent(content: string): { passed: boolean; detail: string } {
    const trimmed = content.trim();
    if (trimmed.length === 0) {
      return { passed: false, detail: 'Content is empty — parsing may have failed completely' };
    }
    if (trimmed.length < 50) {
      return {
        passed: false,
        detail: `Content too short (${trimmed.length} chars, minimum 50) — may be only metadata or page numbers`,
      };
    }
    return { passed: true, detail: `Content OK (${trimmed.length} chars)` };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 双源对撞 — Content Extraction Diff
  // ═══════════════════════════════════════════════════════════════════════════
  // 为什么不做行级 diff？
  //   pdf-parse 输出是纯文本（一行到底），Unstructured 输出是 Markdown（有格式）。
  //   直接逐行对比会 100% 标红——因为格式完全不同。
  //
  // 正确做法：
  //   1. extractPlainText()：去掉所有 Markdown 格式标记，提取纯文本内容
  //   2. diffChars()：按字符级对比纯文本（检测漏字/多字/错字）
  //   3. detectNumberErrors()：专项提取数字并逐位对比（检测 5000→500）
  //
  // 参考：docs/AI-joymini/62-Enterprise-Parse-Quality-Dual-Source-Architecture.md
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 提取纯文本内容（去掉所有 Markdown 格式标记）
   * 这是双源对撞的核心——只有抹平格式差异，才能对比真实内容。
   */
  private extractPlainText(text: string): string {
    return text
      .replace(/#{1,6}\s/g, '')         // 去掉 Markdown 标题标记
      .replace(/\|/g, ' ')               // 去掉表格分隔符
      .replace(/[-]{3,}/g, '')           // 去掉表格分割线
      .replace(/[`*_~]/g, '')            // 去掉 Markdown 强调符号
      .replace(/\n+/g, ' ')              // 换行→空格
      .replace(/\s+/g, '')               // 去掉所有空白
      .trim();
  }

  /**
   * 数字专项检测：从两边提取所有数字，逐位对比
   * 这是最关键的能力——Unstructured 可能把 5000 看错成 500
   */
  private detectNumberErrors(raw: string, parsed: string): NumberError[] {
    const rawNums = raw.match(/\d+[\d,.]*/g) || [];
    const parsedNums = parsed.match(/\d+[\d,.]*/g) || [];
    const errors: NumberError[] = [];
    const maxLen = Math.max(rawNums.length, parsedNums.length);
    for (let i = 0; i < maxLen; i++) {
      if (rawNums[i] !== parsedNums[i]) {
        errors.push({
          raw: rawNums[i],
          parsed: parsedNums[i],
          index: i,
          severity: 'critical',
        });
      }
    }
    return errors;
  }

  /**
   * computeDiff — 双源对撞主方法
   * 1. 抹平格式，提取纯文本
   * 2. diffChars 字符级对比
   * 3. 数字专项检测
   * 4. 计算字错率（WER）
   * 5. 返回结构化 DiffResult
   */
  computeDiff(rawContent: string, content: string): DiffResult {
    const rawPlain = this.extractPlainText(rawContent);
    const parsedPlain = this.extractPlainText(content);

    // 第一步：内容完全一致 → 解析正确，快速返回
    if (rawPlain === parsedPlain) {
      return {
        contentMatch: true,
        diffRanges: [{ type: 'equal', value: content, severity: 'ignore' }],
        numberErrors: [],
        wer: 0,
      };
    }

    // 第二步：字符级 diff
    const changes = diffChars(rawPlain, parsedPlain);

    // 分类差异严重程度
    const diffRanges: DiffRange[] = changes.map((c: Change) => {
      let severity: 'critical' | 'minor' | 'ignore' = 'minor';

      // 如果变化的是纯空白 → ignore
      if (c.value.trim().length === 0) {
        severity = 'ignore';
      }
      // 如果变化的内容包含数字 → critical（数字错是最致命的）
      else if (/\d/.test(c.value)) {
        severity = 'critical';
      }

      return {
        type: c.added ? 'added' : c.removed ? 'removed' : 'equal',
        value: c.count && c.count > 200 ? c.value.slice(0, 200) + '...' : c.value,
        count: c.count,
        severity,
      };
    });

    // 第三步：数字专项检测
    const numberErrors = this.detectNumberErrors(rawPlain, parsedPlain);

    // 第四步：计算字错率（Word Error Rate）
    // WER = (替换数 + 插入数 + 删除数) / 总字数
    // 这里简化：用 changed chars / total chars
    const totalLength = rawPlain.length || 1;
    let changedChars = 0;
    for (const c of changes) {
      if (c.added || c.removed) {
        changedChars += (c.count || c.value.length);
      }
    }
    const wer = Math.round((changedChars / totalLength) * 10000) / 100;

    return {
      contentMatch: false,
      diffRanges,
      numberErrors,
      wer,
    };
  }

  // ──────────── LLM Diff 审计 ────────────

  async llmDiffAudit(
    engineAResult: string,
    engineBResult: string,
    timeoutMs: number = 15_000,
  ): Promise<DiffAuditResult> {
    const prompt = `你是一个文档解析质量审计专家。
同一个 PDF 文件经过两个不同引擎解析，产生了以下两段文本。

请对比分析:
1. 内容完整性: 哪个引擎提取的内容更完整？
2. 数据准确性: 数字、日期、金额是否一致？
3. 结构保留: 表格/列表结构是否合理？
4. 阅读顺序: 多栏排版顺序是否正确？

引擎 A 输出:
${engineAResult.slice(0, 3000)}

引擎 B 输出:
${engineBResult.slice(0, 3000)}

返回 JSON (不要包含其他文字):
{
  "selected": "A" | "B",
  "score": 1-5,
  "reasoning": "选择的原因",
  "issues": ["问题列表"],
  "verdict": "approved" | "needs_review"
}`;

    try {
      const response = await this.aiService.generateText(prompt);

      if (!response) {
        this.logger.warn('LLM Diff audit: AI service returned null');
        return this.fallbackResult(engineAResult, 'AI service returned null');
      }

      // 尝试直接 JSON.parse
      try {
        const parsed = JSON.parse(response);
        return {
          selected: parsed.selected === 'B' ? 'B' : 'A',
          selectedContent: parsed.selected === 'B' ? engineBResult : engineAResult,
          score: typeof parsed.score === 'number' ? parsed.score : 3,
          reasoning: parsed.reasoning || '',
          issues: Array.isArray(parsed.issues) ? parsed.issues : [],
          verdict: parsed.verdict === 'needs_review' ? 'needs_review' : 'approved',
        };
      } catch {
        // JSON 解析失败，用正则提取
        const jsonMatch = (response as string).match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            selected: parsed.selected === 'B' ? 'B' : 'A',
            selectedContent: parsed.selected === 'B' ? engineBResult : engineAResult,
            score: typeof parsed.score === 'number' ? parsed.score : 3,
            reasoning: parsed.reasoning || '',
            issues: Array.isArray(parsed.issues) ? parsed.issues : [],
            verdict: parsed.verdict === 'needs_review' ? 'needs_review' : 'approved',
          };
        }
        this.logger.warn('LLM Diff audit: failed to parse response, falling back to engine A');
        return this.fallbackResult(engineAResult, 'LLM response parsing failed');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`LLM Diff audit failed: ${message}, falling back to engine A`);
      return this.fallbackResult(engineAResult, `LLM error: ${message}`);
    }
  }

  private fallbackResult(content: string, reason: string): DiffAuditResult {
    return {
      selected: 'A',
      selectedContent: content,
      score: 3,
      reasoning: `Fallback: ${reason}`,
      issues: ['LLM audit unavailable'],
      verdict: 'approved',
    };
  }
}
