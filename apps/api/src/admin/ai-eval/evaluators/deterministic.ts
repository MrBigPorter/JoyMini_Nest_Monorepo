import {
  ConversationSnapshot,
  EvalFeedback,
  EvalMessage,
  EvaluatorOptions,
  MessageRole,
  DEFAULT_MAX_LATENCY_MS,
} from './types';

const CJK = /[一-鿿]/g;
const LATIN = /[a-zA-Z]/g;
const SENSITIVE =
  /(银行卡号|银行账号|卡号|身份证号|身份证|信用卡|cvv|card\s*number|account\s*number)/i;
const DRILL_MARKERS = ['死信演练', '__CHAOS__'];

export function detectLanguage(
  text: string,
): 'zh' | 'en' | 'mixed' | 'unknown' {
  const compact = text.replace(/\s+/g, '');
  if (compact.length === 0) return 'unknown';
  const cjk = (compact.match(CJK) ?? []).length;
  const latin = (compact.match(LATIN) ?? []).length;
  const cjkRatio = cjk / compact.length;
  const latinRatio = latin / compact.length;
  if (cjkRatio >= 0.5 && latinRatio < 0.2) return 'zh';
  if (latinRatio >= 0.7 && cjkRatio < 0.1) return 'en';
  if (cjkRatio > 0.1 && latinRatio > 0.1) return 'mixed';
  return 'unknown';
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
  ];
}

export function roleOf(source: string | null | undefined): MessageRole {
  if (source === 'ai') return 'ai';
  if (source === 'human_agent') return 'human_agent';
  if (source === 'system') return 'system';
  return 'user';
}
