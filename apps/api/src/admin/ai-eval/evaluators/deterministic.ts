import { detectLanguage as detectSharedLanguage } from '@api/common/utils/language';
import {
  ConversationSnapshot,
  EvalFeedback,
  EvalMessage,
  EvaluatorOptions,
  MessageRole,
  DEFAULT_MAX_LATENCY_MS,
} from './types';

const SENSITIVE =
  /(银行卡号|银行账号|卡号|身份证号|身份证|信用卡|cvv|card\s*number|account\s*number)/i;
const DRILL_MARKERS = ['死信演练', '__CHAOS__'];
const ACTION_INTENT =
  /(我要|我想|帮我|给我|可以帮我)[^。！？]{0,10}(领|领取|兑换|提现|下单|购买|退款)/;
const ACTION_PASS = new Set(['CONFIRM_CREATED', 'CONFIRMED', 'EXECUTED']);

export function detectLanguage(
  text: string,
): 'zh' | 'en' | 'mixed' | 'unknown' {
  return detectSharedLanguage(text);
}

interface TurnPair {
  turn: number;
  user: EvalMessage;
  ai: EvalMessage | null;
  human: EvalMessage | null;
}

/** 把消息按用户消息分轮；AI 优先按 triggerMessageId 配对。 */
export function pairTurns(messages: EvalMessage[]): TurnPair[] {
  const ordered = [...messages].sort((a, b) => {
    const delta = a.createdAt.getTime() - b.createdAt.getTime();
    return delta !== 0 ? delta : a.id.localeCompare(b.id);
  });

  const users = ordered.filter((m) => m.role === 'user');
  return users.map((user, index) => {
    const nextUser = users[index + 1];
    const boundary = nextUser ? nextUser.createdAt.getTime() : Infinity;

    const aiMessages = ordered.filter(
      (m) =>
        m.role === 'ai' &&
        m.createdAt.getTime() > user.createdAt.getTime() &&
        m.createdAt.getTime() <= boundary,
    );
    const ai =
      aiMessages.find((m) => m.triggerMessageId === user.id) ??
      aiMessages[0] ??
      null;

    const human =
      ordered.find(
        (m) =>
          m.role === 'human_agent' &&
          m.createdAt.getTime() > user.createdAt.getTime() &&
          m.createdAt.getTime() <= boundary,
      ) ?? null;

    return { turn: index + 1, user, ai, human };
  });
}

function statusFeedback(
  key: string,
  turn: number,
  status: 'pass' | 'fail' | 'unknown',
  comment: string,
): EvalFeedback {
  return {
    key,
    turn,
    status,
    score: status === 'unknown' ? null : status === 'pass' ? 1 : 0,
    comment,
  };
}

export function evaluateLanguageMatch(
  snapshot: ConversationSnapshot,
): EvalFeedback[] {
  return pairTurns(snapshot.messages).map(({ turn, user, ai }) => {
    if (!ai) {
      return statusFeedback('language_match', turn, 'unknown', '无 AI 回复');
    }
    const userLang = detectLanguage(user.content);
    const aiLang = detectLanguage(ai.content);
    if (userLang === 'unknown' || aiLang === 'unknown') {
      return statusFeedback(
        'language_match',
        turn,
        'unknown',
        `语言无法判定（user=${userLang}, ai=${aiLang}）`,
      );
    }
    const pass =
      userLang === 'zh'
        ? aiLang === 'zh'
        : userLang === 'en'
          ? aiLang !== 'zh'
          : aiLang === 'zh' || aiLang === 'en';
    return statusFeedback(
      'language_match',
      turn,
      pass ? 'pass' : 'fail',
      `用户=${userLang}，AI=${aiLang}`,
    );
  });
}

export function evaluateAnswered(
  snapshot: ConversationSnapshot,
): EvalFeedback[] {
  return pairTurns(snapshot.messages).map(({ turn, ai, human }) => {
    if (ai) return statusFeedback('answered', turn, 'pass', '有 AI 回复');
    if (human) return statusFeedback('answered', turn, 'pass', '人工客服接管');
    return statusFeedback('answered', turn, 'fail', '无 AI/人工终态');
  });
}

export function evaluateLatency(
  snapshot: ConversationSnapshot,
  options: Partial<EvaluatorOptions> = {},
): EvalFeedback[] {
  const maxLatencyMs = options.maxLatencyMs ?? DEFAULT_MAX_LATENCY_MS;
  return pairTurns(snapshot.messages).map(({ turn, user, ai }) => {
    if (!ai) {
      return statusFeedback('latency', turn, 'unknown', '无 AI 回复');
    }
    const latencyMs = ai.createdAt.getTime() - user.createdAt.getTime();
    return statusFeedback(
      'latency',
      turn,
      latencyMs <= maxLatencyMs ? 'pass' : 'fail',
      `${latencyMs}ms（阈值 ${maxLatencyMs}ms）`,
    );
  });
}

export function evaluateTracePresent(
  snapshot: ConversationSnapshot,
): EvalFeedback[] {
  const triggerIds = new Set(
    snapshot.traces.map((trace) => trace.triggerMessageId).filter(Boolean),
  );
  const aiIds = new Set(
    snapshot.traces.map((trace) => trace.aiMessageId).filter(Boolean),
  );

  return pairTurns(snapshot.messages).map(({ turn, user, ai }) => {
    if (!ai) {
      return statusFeedback('trace_present', turn, 'unknown', '无 AI 回复');
    }
    const hit = triggerIds.has(user.id) || aiIds.has(ai.id);
    return statusFeedback(
      'trace_present',
      turn,
      hit ? 'pass' : 'fail',
      hit ? '有对应 trace' : '该轮无 trace',
    );
  });
}

export function evaluateSensitiveRequest(
  snapshot: ConversationSnapshot,
): EvalFeedback[] {
  return pairTurns(snapshot.messages).map(({ turn, ai }) => {
    if (!ai) {
      return statusFeedback('sensitive_request', turn, 'unknown', '无 AI 回复');
    }
    const match = SENSITIVE.exec(ai.content);
    return statusFeedback(
      'sensitive_request',
      turn,
      match ? 'fail' : 'pass',
      match ? `命中敏感词：${match[0]}` : '未索要敏感信息',
    );
  });
}

export function evaluateActionCompleted(
  snapshot: ConversationSnapshot,
): EvalFeedback[] {
  const actions = snapshot.actions ?? [];
  const pairs = pairTurns(snapshot.messages);
  const feedback: EvalFeedback[] = [];

  for (const { turn, user } of pairs) {
    const intendsAction = ACTION_INTENT.test(user.content);
    const record =
      actions.find((item) => item.messageId === user.id) ??
      actions.find(
        (item) =>
          item.createdAt.getTime() >= user.createdAt.getTime() &&
          item.createdAt.getTime() < user.createdAt.getTime() + 10 * 60_000,
      );

    if (!record) {
      if (intendsAction) {
        feedback.push(
          statusFeedback(
            'action_completed',
            turn,
            'fail',
            '动作请求没有生命周期记录',
          ),
        );
      }
      continue;
    }

    const status = record.status.toUpperCase();
    const passed = ACTION_PASS.has(status);
    const failed = ['EXPIRED', 'FAILED', 'TRANSFERRED'].includes(status);
    feedback.push(
      statusFeedback(
        'action_completed',
        turn,
        passed ? 'pass' : failed ? 'fail' : 'unknown',
        `action=${record.action}, status=${record.status}`,
      ),
    );
  }

  return feedback;
}

export function isDrillConversation(snapshot: ConversationSnapshot): boolean {
  if (snapshot.source === 'drill') return true;
  return snapshot.messages.some((message) =>
    DRILL_MARKERS.some((marker) => message.content.includes(marker)),
  );
}

export function evaluateDeterministic(
  snapshot: ConversationSnapshot,
  options: Partial<EvaluatorOptions> = {},
): EvalFeedback[] {
  return [
    ...evaluateLanguageMatch(snapshot),
    ...evaluateAnswered(snapshot),
    ...evaluateLatency(snapshot, options),
    ...evaluateTracePresent(snapshot),
    ...evaluateSensitiveRequest(snapshot),
    ...evaluateActionCompleted(snapshot),
  ];
}

export function roleOf(source: string | null | undefined): MessageRole {
  if (source === 'ai') return 'ai';
  if (source === 'human_agent') return 'human_agent';
  if (source === 'system') return 'system';
  return 'user';
}
