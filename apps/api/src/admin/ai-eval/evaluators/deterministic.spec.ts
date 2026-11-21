import {
  detectLanguage,
  evaluateActionCompleted,
  evaluateAnswered,
  evaluateDeterministic,
  evaluateLanguageMatch,
  evaluateLatency,
  evaluateSensitiveRequest,
  evaluateTracePresent,
  isDrillConversation,
  pairTurns,
} from './deterministic';
import { ConversationSnapshot, EvalMessage } from './types';

const t0 = new Date('2026-11-20T12:00:00Z');

function msg(
  id: string,
  role: EvalMessage['role'],
  content: string,
  seconds: number,
  triggerMessageId: string | null = null,
): EvalMessage {
  return {
    id,
    role,
    content,
    createdAt: new Date(t0.getTime() + seconds * 1000),
    triggerMessageId,
  };
}

function snapshot(
  messages: EvalMessage[],
  traces: ConversationSnapshot['traces'] = [],
): ConversationSnapshot {
  return { conversationId: 'c1', source: 'sim', messages, traces };
}

describe('detectLanguage', () => {
  it('识别中英混合与无法判定', () => {
    expect(detectLanguage('我的优惠券在哪')).toBe('zh');
    expect(detectLanguage('Where are my coupons?')).toBe('en');
    expect(detectLanguage('我的 coupon 在哪')).toBe('mixed');
    expect(detectLanguage('123 !!!')).toBe('unknown');
  });
});

describe('deterministic evaluators', () => {
  it('中问英答判为 language fail', () => {
    const result = evaluateLanguageMatch(
      snapshot([
        msg('u1', 'user', '我的券什么时候过期？', 0),
        msg('a1', 'ai', 'Your coupon expires tomorrow.', 2, 'u1'),
      ]),
    );
    expect(result[0].status).toBe('fail');
    expect(result[0].comment).toContain('用户=zh');
  });

  it('按 triggerMessageId 配对，不被后面的消息误导', () => {
    const result = evaluateAnswered(
      snapshot([
        msg('u1', 'user', '帮我领券', 0),
        msg('u2', 'user', '死信演练', 60),
        msg('a2', 'ai', '只能回答优惠券问题', 90, 'u2'),
      ]),
    );
    const byTurn = new Map(result.map((r) => [r.turn, r]));
    expect(byTurn.get(1)?.status).toBe('fail');
    expect(byTurn.get(2)?.status).toBe('pass');
  });

  it('人工客服接管算 answered', () => {
    const result = evaluateAnswered(
      snapshot([
        msg('u1', 'user', '在吗', 0),
        msg('h1', 'human_agent', '在的', 30),
      ]),
    );
    expect(result[0].status).toBe('pass');
    expect(result[0].comment).toContain('人工');
  });

  it('超时判 latency fail', () => {
    const result = evaluateLatency(
      snapshot([
        msg('u1', 'user', '你好', 0),
        msg('a1', 'ai', '你好', 5),
      ]),
      { maxLatencyMs: 10_000 },
    );
    expect(result[0].status).toBe('pass');

    const slow = evaluateLatency(
      snapshot([
        msg('u1', 'user', '你好', 0),
        msg('a1', 'ai', '你好', 30),
      ]),
      { maxLatencyMs: 10_000 },
    );
    expect(slow[0].status).toBe('fail');
  });

  it('按 triggerMessageId / aiMessageId 判断 trace', () => {
    const messages = [
      msg('u1', 'user', '你好', 0),
      msg('a1', 'ai', '你好', 2, 'u1'),
    ];
    expect(
      evaluateTracePresent(
        snapshot(messages, [
          {
            id: 't1',
            triggerMessageId: 'u1',
            aiMessageId: null,
            createdAt: t0,
          },
        ]),
      )[0].status,
    ).toBe('pass');

    expect(evaluateTracePresent(snapshot(messages))[0].status).toBe('fail');
  });

  it('索要银行卡号判 sensitive fail', () => {
    const result = evaluateSensitiveRequest(
      snapshot([
        msg('u1', 'user', '提现', 0),
        msg('a1', 'ai', '请提供银行卡号和持卡人姓名', 2, 'u1'),
      ]),
    );
    expect(result[0].status).toBe('fail');
    expect(result[0].comment).toContain('银行卡号');
  });

  it('识别演练会话', () => {
    expect(
      isDrillConversation(
        snapshot([
          msg('u1', 'user', '死信演练：这条消息用于触发真实队列重试', 0),
        ]),
      ),
    ).toBe(true);
  });

  it('pairTurns 按用户消息分轮', () => {
    const turns = pairTurns(
      snapshot([
        msg('u1', 'user', '第一句', 0),
        msg('a1', 'ai', '第一答', 2, 'u1'),
        msg('u2', 'user', '第二句', 10),
      ]).messages,
    );
    expect(turns.map((t) => t.turn)).toEqual([1, 2]);
    expect(turns[0].ai?.id).toBe('a1');
    expect(turns[1].ai).toBeNull();
  });

  it('evaluateDeterministic 覆盖全部 key', () => {
    const result = evaluateDeterministic(
      snapshot([
        msg('u1', 'user', '你好', 0),
        msg('a1', 'ai', '你好呀', 2, 'u1'),
      ]),
    );
    expect(new Set(result.map((r) => r.key))).toEqual(
      new Set([
        'language_match',
        'answered',
        'latency',
        'trace_present',
        'sensitive_request',
      ]),
    );
  });

  it('动作请求无生命周期记录判 fail', () => {
    const result = evaluateActionCompleted(
      snapshot([msg('u1', 'user', '帮我领 Big Spender', 0)]),
    );
    expect(result[0]).toMatchObject({
      key: 'action_completed',
      status: 'fail',
    });
  });

  it('确认卡片/执行算完成，过期算失败', () => {
    const base = snapshot([msg('u1', 'user', '帮我领券', 0)]);
    const withAction = (status: string) => ({
      ...base,
      actions: [
        {
          id: 'act1',
          messageId: 'u1',
          action: 'claim_coupon',
          status,
          createdAt: t0,
        },
      ],
    });

    expect(evaluateActionCompleted(withAction('CONFIRM_CREATED'))[0].status).toBe(
      'pass',
    );
    expect(evaluateActionCompleted(withAction('EXECUTED'))[0].status).toBe(
      'pass',
    );
    expect(evaluateActionCompleted(withAction('EXPIRED'))[0].status).toBe(
      'fail',
    );
  });

  it('非动作消息不产生 action 反馈', () => {
    expect(
      evaluateActionCompleted(snapshot([msg('u1', 'user', '你好', 0)])),
    ).toEqual([]);
  });
});
