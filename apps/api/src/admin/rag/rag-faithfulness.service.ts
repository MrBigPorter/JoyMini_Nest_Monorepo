import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { SystemMessage } from '@langchain/core/messages';
import {
  createLLM,
  LlmProviderConfig,
} from '@api/client/ai-customer/graph/llm-factory';

export interface FaithfulnessSource {
  title?: string;
  docId?: string;
  content: string;
}

export interface FaithfulnessResult {
  faithful: boolean;
  score: number;
  unsupportedClaims: string[];
  reason: string;
  error?: string;
}

const MAX_SOURCE_CHARS = 2000;
const MAX_TOTAL_SOURCE_CHARS = 8000;
const MAX_ANSWER_CHARS = 4000;

const JUDGE_SYSTEM_PROMPT = `You are a strict RAG faithfulness judge.
Given a question, an answer, and retrieved sources, decide whether every factual claim
in the answer is supported by the sources.
Return ONLY a JSON object:
{"faithful": true|false, "score": 0.0-1.0, "unsupportedClaims": ["..."], "reason": "..."}
Rules:
- Use ONLY the sources; no outside knowledge.
- If a number, date, fee, or policy is not in the sources, mark it unsupported.
- score=1 only when every factual claim is supported; 0 when the answer contradicts or invents facts.
- unsupportedClaims must be short quotes/phrases from the answer.`;

/** 组装 judge 输入；对超长 source/answer 截断，避免超出上下文。 */
export function buildJudgeInput(
  question: string,
  answer: string,
  sources: FaithfulnessSource[],
): string {
  let totalSourceChars = 0;
  const sourceBlocks: string[] = [];

  for (let i = 0; i < sources.length; i += 1) {
    if (totalSourceChars >= MAX_TOTAL_SOURCE_CHARS) break;
    const source = sources[i];
    const remaining = MAX_TOTAL_SOURCE_CHARS - totalSourceChars;
    const content = String(source.content ?? '').slice(
      0,
      Math.min(MAX_SOURCE_CHARS, remaining),
    );
    totalSourceChars += content.length;
    sourceBlocks.push(
      `[${i + 1}] ${source.title ?? ''} (${source.docId ?? ''})\n${content}`,
    );
  }

  return [
    `QUESTION:\n${question}`,
    `ANSWER:\n${String(answer ?? '').slice(0, MAX_ANSWER_CHARS)}`,
    `SOURCES:\n${sourceBlocks.join('\n\n---\n\n')}`,
  ].join('\n\n');
}

/** 解析 judge 输出；容忍 markdown code fence，非法输出返回 null。 */
export function parseJudgeOutput(raw: string): FaithfulnessResult | null {
  const stripped = String(raw ?? '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end < start) return null;

  try {
    const parsed = JSON.parse(stripped.slice(start, end + 1));
    if (typeof parsed.faithful !== 'boolean') return null;

    const rawScore = Number(parsed.score);
    const score = Number.isFinite(rawScore)
      ? Math.max(0, Math.min(1, rawScore))
      : parsed.faithful
        ? 1
        : 0;

    const unsupportedClaims = Array.isArray(parsed.unsupportedClaims)
      ? parsed.unsupportedClaims
          .filter((claim: unknown) => typeof claim === 'string')
          .slice(0, 10)
      : [];

    return {
      faithful: parsed.faithful,
      score: Number(score.toFixed(2)),
      unsupportedClaims,
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    };
  } catch {
    return null;
  }
}

@Injectable()
export class RagFaithfulnessService {
  private readonly logger = new Logger(RagFaithfulnessService.name);
  private readonly chain;

  constructor(private readonly configService: ConfigService) {
    const llmConfig: LlmProviderConfig = {
      type: this.configService.get<'online' | 'local'>('AI_LLM_TYPE', 'local'),
      model: this.configService.get<string>('OLLAMA_MODEL', 'qwen3.5:0.8b'),
      baseURL: this.configService.get<string>(
        'AI_OLLAMA_BASE_URL',
        'http://localhost:11434',
      ),
      apiKey: this.configService.get<string>('DEEPSEEK_API_KEY'),
    };

    const prompt = ChatPromptTemplate.fromMessages([
      // 用 SystemMessage 实例而不是模板字符串：
      // prompt 里的 JSON 花括号会被 ChatPromptTemplate 当成变量占位符。
      new SystemMessage(JUDGE_SYSTEM_PROMPT),
      ['human', '{input}'],
    ]);
    this.chain = prompt
      .pipe(createLLM(llmConfig, { temperature: 0 }))
      .pipe(new StringOutputParser());
  }

  async judge(
    question: string,
    answer: string,
    sources: FaithfulnessSource[],
  ): Promise<FaithfulnessResult> {
    if (!sources || sources.length === 0) {
      return {
        faithful: false,
        score: 0,
        unsupportedClaims: [],
        reason: 'no_sources',
      };
    }

    const input = buildJudgeInput(question, answer, sources);
    try {
      const raw = await this.chain.invoke({ input });
      const parsed = parseJudgeOutput(raw);
      if (!parsed) {
        this.logger.warn('[faithfulness] judge output is not valid JSON');
        return {
          faithful: false,
          score: 0,
          unsupportedClaims: [],
          reason: 'judge_parse_failed',
          error: String(raw).slice(0, 500),
        };
      }
      return parsed;
    } catch (err: any) {
      this.logger.warn(
        `[faithfulness] judge call failed: ${err?.message ?? err}`,
      );
      return {
        faithful: false,
        score: 0,
        unsupportedClaims: [],
        reason: 'judge_error',
        error: String(err?.message ?? err).slice(0, 500),
      };
    }
  }
}
