import {
  DEFAULT_GROUNDING_GATE_MODE,
  parseGroundingGateMode,
  readGroundingGateMode,
} from './grounding-gate';

describe('grounding gate mode', () => {
  it.each([
    ['off', 'off'],
    ['shadow', 'shadow'],
    ['enforce', 'enforce'],
    ['  ENFORCE  ', 'enforce'],
  ])('合法值 %s → %s', (raw, expected) => {
    expect(parseGroundingGateMode(raw)).toEqual({
      mode: expected,
      invalid: false,
    });
  });

  it.each([undefined, null, '', 'on', 'enforece'])(
    '非法值 %s 回落默认并标记',
    (raw) => {
      const parsed = parseGroundingGateMode(raw);
      expect(parsed.mode).toBe(DEFAULT_GROUNDING_GATE_MODE);
      expect(parsed.invalid).toBe(raw !== undefined && raw !== null && raw !== '');
    },
  );

  it('未设置环境变量时默认 shadow', () => {
    expect(readGroundingGateMode(undefined)).toBe('shadow');
  });

  it('非法环境变量回落 shadow', () => {
    expect(readGroundingGateMode('enforece')).toBe('shadow');
  });
});

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  AI_FAILURE_REPLY,
  handoffReply,
  OFFLINE_HANDOFF_REPLY,
  QUOTA_EXCEEDED_REPLY,
} from '@api/client/ai-customer/ai-failure-handler';
import {
  classifyGrounding,
  countSuccessfulToolCalls,
  decideGroundingGate,
  hasFactualAssertion,
  isCannedReply,
  isClarificationOnly,
  NO_EVIDENCE_HANDOFF_REPLY,
} from './grounding-gate';

describe('classifyGrounding · 依据分型', () => {
  it.each([
    ['canned 优先于一切', { canned: true, ragSourceCount: 3, toolCallCount: 2 }, 'fallback'],
    ['工具优先于知识库', { ragSourceCount: 3, toolCallCount: 1 }, 'tool'],
    ['只有知识库', { ragSourceCount: 2 }, 'kb'],
    ['回答自带 sources 也算 kb', { citedSourceCount: 1 }, 'kb'],
    ['什么都没有', {}, 'none'],
  ])('%s', (_name, inputs, expected) => {
    expect(classifyGrounding(inputs)).toBe(expected);
  });

  it('工具调用全失败 → 不算依据', () => {
    const spans = [{ status: 'ERROR' }, { status: 'ERROR' }];
    const toolCallCount = countSuccessfulToolCalls(spans as any);
    expect(toolCallCount).toBe(0);
    expect(classifyGrounding({ toolCallCount })).toBe('none');
  });

  it('至少一个工具成功 → tool', () => {
    expect(
      countSuccessfulToolCalls([{ status: 'ERROR' }, { status: 'OK' }] as any),
    ).toBe(1);
  });
});

describe('isCannedReply · 兜底话术识别', () => {
  it.each([
    [OFFLINE_HANDOFF_REPLY],
    [AI_FAILURE_REPLY],
    [QUOTA_EXCEEDED_REPLY],
    // enforce 降级后的转人工通知同样是兜底：它不是回答，trace 要记 fallback
    [NO_EVIDENCE_HANDOFF_REPLY],
    [`前缀 ${AI_FAILURE_REPLY} 后缀`],
  ])('命中静态话术：%s', (text) => {
    expect(isCannedReply(text)).toBe(true);
  });

  it.each(['', '  ', null, undefined, '您的余额是 100 元。'])(
    '正常回复/空值不算兜底：%s',
    (text) => {
      expect(isCannedReply(text as any)).toBe(false);
    },
  );

  it.each(['ai_failure', 'offline_handoff', 'quota_exceeded', 'no_evidence'] as const)(
    '英文降级话术同样算兜底（%s），否则英文降级会被当成真实回答',
    (kind) => {
      const text = handoffReply(kind, 'Where is my order?');
      expect(text).not.toMatch(/[一-鿿]/);
      expect(isCannedReply(text)).toBe(true);
    },
  );
});

describe('isClarificationOnly · 纯澄清判定', () => {
  it.each([
    '请问您的订单号是多少？',
    '您能提供一下注册手机号吗?',
    // shadow 全量验收发现的误降级：「规则/政策」只是追问从句的宾语，不是断言
    '您是想了解优惠券的使用规则，还是需要我帮您查一下？',
    '您是想了解退货政策中关于运费承担的规定，还是查询某个订单的退货运费？',
    'are you asking about cancelling an order, or looking for information on the cancellation policy?',
  ])('以问号结尾且陈述从句无断言 → 澄清：%s', (text) => {
    expect(isClarificationOnly(text)).toBe(true);
  });

  it.each([
    ['退款需要 3-5 个工作日到账，请耐心等待。', '有事实断言（时长）'],
    ['提现手续费是 2%，确认继续吗？', '问句里带金额/比例（在问句之前已陈述）'],
    ['订单已发货了，您还有其他问题吗？', '带状态断言'],
    ['好的，已为您记录。', '不是问句'],
    ['', '空回复'],
    // 2026-11-24 enforce 验收漏网：菲律宾语步骤 + 时长，句尾带问句
    [
      'Makikredito ang pera sa loob ng 1-24 oras. May tanong ka pa ba?',
      '菲律宾语时长断言（词表已补）',
    ],
  ])('%s → 不是纯澄清（%s）', (text) => {
    expect(isClarificationOnly(text)).toBe(false);
  });

  it('陈述部分有规则断言、结尾才追问 → 不算纯澄清', () => {
    const text =
      '关于叠加规则，我这边无法确认具体政策，建议以结算页面为准。需要我帮您查一下优惠券吗？';
    expect(isClarificationOnly(text)).toBe(false);
  });
});

describe('hasFactualAssertion · 事实断言', () => {
  it.each([
    '退款需要 3-5 个工作日到账。',
    '提现手续费是 2%。',
    '根据政策，订单支持 7 天无理由退货。',
    'Makikredito ang pera sa loob ng 1-24 oras.',
    'Puwede sa 7-Eleven, MLhuillier, o Palawan Pawnshop.',
    'According to the policy, refunds take 3 days.',
  ])('有断言：%s', (text) => {
    expect(hasFactualAssertion(text)).toBe(true);
  });

  it.each([
    '好的，我马上为您处理。',
    'Maria Santos',
    '收到，请稍等。',
    '请问您的订单号是多少？',
    '',
  ])('无断言：%s', (text) => {
    expect(hasFactualAssertion(text as string)).toBe(false);
  });
});

describe('decideGroundingGate · 发布门禁', () => {
  it('业务意图 + 无依据 + 非澄清 → degrade', () => {
    expect(
      decideGroundingGate({
        grounding: 'none',
        intent: 'order',
        clarificationOnly: false,
      }),
    ).toBe('degrade');
  });

  it('业务意图 + 无依据但没有事实断言（动作流流程性文字）→ allow', () => {
    // 2026-11-24 enforce 验收：地址动作流里模型没出确认卡、只回文字，
    // 门禁把它降级转人工，动作流直接中断（业务动作 7/7 → 5/7）。
    expect(
      decideGroundingGate({
        grounding: 'none',
        intent: 'user',
        clarificationOnly: false,
        factualAssertion: false,
      }),
    ).toBe('allow');
  });

  it('未显式传 factualAssertion 时按 fail-closed 处理（照常降级）', () => {
    expect(
      decideGroundingGate({ grounding: 'none', intent: 'order' }),
    ).toBe('degrade');
  });

  it.each(['kb', 'tool', 'fallback'] as const)(
    '有依据（%s）→ allow',
    (grounding) => {
      expect(decideGroundingGate({ grounding, intent: 'order' })).toBe('allow');
    },
  );

  it('纯澄清 → allow', () => {
    expect(
      decideGroundingGate({
        grounding: 'none',
        intent: 'order',
        clarificationOnly: true,
      }),
    ).toBe('allow');
  });

  it.each(['general', 'transfer', 'unknown', null, undefined])(
    '非业务意图（%s）→ allow',
    (intent) => {
      expect(decideGroundingGate({ grounding: 'none', intent })).toBe('allow');
    },
  );

  it('降级话术不含金额/时效/规则断言', () => {
    expect(NO_EVIDENCE_HANDOFF_REPLY).not.toMatch(/\d+\s*(元|天|小时|%)/);
    expect(NO_EVIDENCE_HANDOFF_REPLY).not.toMatch(/政策|规则|余额/);
  });
});

/**
 * 两口径一致性：线上分型与评测分型必须对同一组输入给出同一个答案，
 * 否则报告里的 kb/tool/none 与 trace 里的 grounding 会对不上。
 * judge.mjs 是 ESM，测试里用子进程跑它，避免 ts-jest 的 ESM 限制。
 */
describe('与 tools/eval/e2e/judge.mjs 分型一致', () => {
  const judgePath = resolve(
    __dirname,
    '../../../../../../../../tools/eval/e2e/judge.mjs',
  );
  const inputs = [
    { ragSourceCount: 0, citedSourceCount: 0, toolCallCount: 0 },
    { ragSourceCount: 2, citedSourceCount: 0, toolCallCount: 0 },
    { ragSourceCount: 0, citedSourceCount: 1, toolCallCount: 0 },
    { ragSourceCount: 3, citedSourceCount: 0, toolCallCount: 1 },
    { ragSourceCount: 0, citedSourceCount: 5, toolCallCount: 2 },
  ];

  it('同一组输入得到同一分型（tool > kb > none）', () => {
    expect(existsSync(judgePath)).toBe(true);

    const script = [
      `import { classifyGrounding } from ${JSON.stringify(pathToFileURL(judgePath).href)};`,
      `const inputs = ${JSON.stringify(inputs)};`,
      'const out = inputs.map((i) => classifyGrounding({',
      '  ragSourceCount: i.ragSourceCount,',
      '  cited: i.citedSourceCount > 0,',
      '  tools: Array.from({ length: i.toolCallCount }, (_, n) => `t${n}`),',
      '}));',
      'console.log(JSON.stringify(out));',
    ].join('\n');

    const stdout = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', script],
      { encoding: 'utf8' },
    );
    const judgeKinds = JSON.parse(stdout.trim());
    const prodKinds = inputs.map((i) => classifyGrounding(i));

    expect(prodKinds).toEqual(judgeKinds);
  });
});
