import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AddEvalCasesDto,
  EvalCaseDto,
  UpdateEvalCaseDto,
} from './eval-dataset.dto';
import {
  CreateExternalRunDto,
  IngestExternalResultsDto,
} from './external-eval.dto';

const baseCase = {
  question: '怎么退款',
  answer: '在订单页申请退款',
};

async function errorsOf(cls: any, payload: unknown) {
  return validate(plainToInstance(cls, payload) as object, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

function flatten(errors: any[]): string[] {
  return errors.flatMap((error) => [
    ...Object.keys(error.constraints ?? {}),
    ...flatten(error.children ?? []),
  ]);
}

describe('评测用例 DTO 输入上限', () => {
  it('题干 2000 通过、2001 拒绝', async () => {
    expect(
      await errorsOf(EvalCaseDto, { ...baseCase, question: 'q'.repeat(2000) }),
    ).toEqual([]);

    const errors = await errorsOf(EvalCaseDto, {
      ...baseCase,
      question: 'q'.repeat(2001),
    });
    expect(flatten(errors)).toContain('maxLength');
  });

  it('答案 8000 通过、8001 拒绝', async () => {
    expect(
      await errorsOf(EvalCaseDto, { ...baseCase, answer: 'a'.repeat(8000) }),
    ).toEqual([]);

    const errors = await errorsOf(EvalCaseDto, {
      ...baseCase,
      answer: 'a'.repeat(8001),
    });
    expect(flatten(errors)).toContain('maxLength');
  });

  it('标签 20 个×32 字符通过，21 个或 33 字符拒绝', async () => {
    expect(
      await errorsOf(EvalCaseDto, {
        ...baseCase,
        tags: Array.from({ length: 20 }, () => 't'.repeat(32)),
      }),
    ).toEqual([]);

    expect(
      flatten(
        await errorsOf(EvalCaseDto, {
          ...baseCase,
          tags: Array.from({ length: 21 }, () => 'tag'),
        }),
      ),
    ).toContain('arrayMaxSize');

    expect(
      flatten(
        await errorsOf(EvalCaseDto, {
          ...baseCase,
          tags: ['t'.repeat(33)],
        }),
      ),
    ).toContain('maxLength');
  });

  it('必含关键词 20 个×500 字符通过，21 个或 501 字符拒绝', async () => {
    const ok = Array.from({ length: 20 }, () => 'k'.repeat(500));
    expect(
      await errorsOf(EvalCaseDto, {
        ...baseCase,
        expect: { mustMention: ok },
      }),
    ).toEqual([]);

    expect(
      flatten(
        await errorsOf(EvalCaseDto, {
          ...baseCase,
          expect: {
            mustMention: Array.from({ length: 21 }, () => 'k'),
          },
        }),
      ),
    ).toContain('isEvalExpectation');

    expect(
      flatten(
        await errorsOf(EvalCaseDto, {
          ...baseCase,
          expect: { mustMention: ['k'.repeat(501)] },
        }),
      ),
    ).toContain('isEvalExpectation');
  });

  it('判分条件序列化后 8KB 通过、超出拒绝（expect 与 expected 同一规则）', async () => {
    const nearLimit = { note: 'x'.repeat(8100) };
    expect(
      await errorsOf(EvalCaseDto, { ...baseCase, expect: nearLimit }),
    ).toEqual([]);

    const tooBig = { note: 'x'.repeat(9000) };
    expect(
      flatten(await errorsOf(EvalCaseDto, { ...baseCase, expect: tooBig })),
    ).toContain('isEvalExpectation');
    expect(
      flatten(await errorsOf(EvalCaseDto, { ...baseCase, expected: tooBig })),
    ).toContain('isEvalExpectation');
    // 字符串型 expected 也走自定义字节校验，而不是 @MaxLength
    expect(
      flatten(
        await errorsOf(EvalCaseDto, {
          ...baseCase,
          expected: 'x'.repeat(9000),
        }),
      ),
    ).toContain('isEvalExpectation');
  });

  it('更新用例同样受题干/答案/标签/判分条件上限约束', async () => {
    expect(
      flatten(
        await errorsOf(UpdateEvalCaseDto, { question: 'q'.repeat(2001) }),
      ),
    ).toContain('maxLength');
    expect(
      flatten(
        await errorsOf(UpdateEvalCaseDto, { answer: 'a'.repeat(8001) }),
      ),
    ).toContain('maxLength');
    expect(
      flatten(
        await errorsOf(UpdateEvalCaseDto, {
          tags: Array.from({ length: 21 }, () => 'tag'),
        }),
      ),
    ).toContain('arrayMaxSize');
    expect(
      flatten(
        await errorsOf(UpdateEvalCaseDto, {
          expect: { note: 'x'.repeat(9000) },
        }),
      ),
    ).toContain('isEvalExpectation');
  });

  it('批量导入 100 条通过、101 条拒绝', async () => {
    expect(
      await errorsOf(AddEvalCasesDto, {
        cases: Array.from({ length: 100 }, () => ({ ...baseCase })),
      }),
    ).toEqual([]);

    expect(
      flatten(
        await errorsOf(AddEvalCasesDto, {
          cases: Array.from({ length: 101 }, () => ({ ...baseCase })),
        }),
      ),
    ).toContain('arrayMaxSize');
  });

  it('外部运行用例 500 条通过、501 条拒绝；结果同样 500 上限', async () => {
    const snapshot = {
      caseId: 'case-1',
      question: '怎么退款',
    };
    const run = {
      datasetFingerprint: 'abcd1234',
      codeVersion: 'sha',
      gateMode: 'shadow',
      judgeSpecVersion: 'judge-1',
      metricSpecVersion: '3',
    };
    expect(
      await errorsOf(CreateExternalRunDto, {
        ...run,
        cases: Array.from({ length: 500 }, () => ({ ...snapshot })),
      }),
    ).toEqual([]);
    expect(
      flatten(
        await errorsOf(CreateExternalRunDto, {
          ...run,
          cases: Array.from({ length: 501 }, () => ({ ...snapshot })),
        }),
      ),
    ).toContain('arrayMaxSize');

    expect(
      await errorsOf(IngestExternalResultsDto, {
        cases: Array.from({ length: 500 }, () => ({
          caseId: 'case-1',
          answerVerdict: 'correct',
          reason: 'ok',
        })),
      }),
    ).toEqual([]);
    expect(
      flatten(
        await errorsOf(IngestExternalResultsDto, {
          cases: Array.from({ length: 501 }, () => ({
            caseId: 'case-1',
            answerVerdict: 'correct',
            reason: 'ok',
          })),
        }),
      ),
    ).toContain('arrayMaxSize');
  });
});
