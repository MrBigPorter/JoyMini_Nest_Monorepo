import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '@api/common/ai/ai.service';

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
