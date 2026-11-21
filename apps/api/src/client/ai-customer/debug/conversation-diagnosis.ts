/**
 * 会话诊断：把「state 里有什么」翻译成「运营一眼能看出出了什么事」。
 *
 * 只做可从现有数据证明的判断，不猜原因：
 * - 最后一条用户消息有没有被回复
 * - AI 是否在索要敏感信息
 * - 中问英答
 * - 用户在做交易，流程却停在查询
 * - 有没有链路可查
 *
 * 纯函数，便于单测；调用方负责提供消息、flowState 与 trace 是否存在。
 */

export interface DiagnosisMessage {
  type: string; // human / ai / human_agent / system
  content: string;
  createdAt: string | null;
}

export interface DiagnosisAction {
  action: string;
  status: string;
  error?: string | null;
}

export interface ConversationDiagnosisFlag {
  key:
    | 'unanswered'
    | 'sensitive_request'
    | 'language_mismatch'
    | 'intent_flow_mismatch'
    | 'action_unfinished'
    | 'no_trace';
  label: string;
  detail: string;
  severity: 'high' | 'medium' | 'low';
}

export interface ConversationDiagnosis {
  unanswered: boolean;
  lastUserMessageAt: string | null;
  idleMinutes: number | null;
  sensitiveRequest: boolean;
  languageMismatch: boolean;
  intentFlowMismatch: boolean;
  hasTrace: boolean;
  flags: ConversationDiagnosisFlag[];
}

const CJK = /[一-鿿]/;
const SENSITIVE =
  /(银行卡号|银行账号|卡号|身份证号|身份证|信用卡|cvv|card\s*number|account\s*number)/i;
const TRANSACTION =
  /(我要|我想|帮我|给我|可以帮我|能否)[^。！？]{0,8}(提现|转账|退款|下单|购买|支付|充值|取消订单)/;
const QUERY_FLOW = /(_QUERY$|^GENERAL$)/;

function isAi(type: string): boolean {
  return type === 'ai' || type === 'assistant';
}

function isHuman(type: string): boolean {
  return type === 'human' || type === 'user';
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : null;
}

export function buildConversationDiagnosis(input: {
  messages: DiagnosisMessage[];
  flowState: Record<string, unknown>;
  hasTrace: boolean;
  actions?: DiagnosisAction[];
  now?: Date;
}): ConversationDiagnosis {
  const now = input.now ?? new Date();
  const messages = input.messages.filter(
    (m) => typeof m.content === 'string' && m.content.trim().length > 0,
  );
  const last = messages[messages.length - 1];
  const lastHuman = [...messages].reverse().find((m) => isHuman(m.type));
  const lastAi = [...messages].reverse().find((m) => isAi(m.type));

  const unanswered = Boolean(last && isHuman(last.type));
  const lastUserMessageAt = lastHuman?.createdAt ?? null;
  const lastUserTs = parseTime(lastUserMessageAt);
  const idleMinutes =
    unanswered && lastUserTs != null
      ? Math.max(0, Math.round((now.getTime() - lastUserTs) / 60000))
      : null;

  const activeFlow =
    typeof input.flowState?.activeFlow === 'string'
      ? input.flowState.activeFlow
      : null;
  const flowStep =
    typeof input.flowState?.step === 'string' ? input.flowState.step : null;

  const lastHumanText = lastHuman?.content ?? '';
  const lastAiText = lastAi?.content ?? '';

  // 敏感信息不只看最后一条：AI 本轮早些时候索要过卡号，
  // 之后即使转人工，这个风险仍然存在，运营必须看到。
  const sensitiveAi = [...messages]
    .filter((m) => isAi(m.type))
    .slice(-4)
    .reverse()
    .find((m) => SENSITIVE.test(m.content));
  const sensitiveRequest = Boolean(sensitiveAi);

  const languageMismatch =
    CJK.test(lastHumanText) &&
    lastAiText.length > 20 &&
    !CJK.test(lastAiText) &&
    (lastAiText.match(/[a-zA-Z]/g)?.length ?? 0) > 20;

  const intentFlowMismatch =
    Boolean(activeFlow) &&
    TRANSACTION.test(lastHumanText) &&
    QUERY_FLOW.test(activeFlow ?? '');

  const flags: ConversationDiagnosisFlag[] = [];

  if (unanswered) {
    flags.push({
      key: 'unanswered',
      label: '最后一条用户消息未回复',
      detail:
        idleMinutes != null
          ? `已等待 ${formatWait(idleMinutes)}`
          : '消息已落库，但没有对应的 AI 回复',
      severity: 'high',
    });
  }

  if (sensitiveRequest) {
    flags.push({
      key: 'sensitive_request',
      label: 'AI 回复中曾索要敏感信息',
      detail:
        '出现银行卡号/卡号/身份证等字段，应转人工或引导到安全页面，不应在聊天里收集',
      severity: 'high',
    });
  }

  if (languageMismatch) {
    flags.push({
      key: 'language_mismatch',
      label: '用户中文提问，AI 用英文回答',
      detail: '语言不一致会让用户放弃追问，需检查提示词/模型输出约束',
      severity: 'medium',
    });
  }

  if (intentFlowMismatch) {
    flags.push({
      key: 'intent_flow_mismatch',
      label: '意图与当前流程不一致',
      detail: `用户在描述交易类操作，当前流程却是 ${activeFlow}${
        flowStep ? `（${flowStep}）` : ''
      }`,
      severity: 'medium',
    });
  }

  // 确认卡片动作的终态：取消/失败/过期都要在诊断里说明，
  // 否则运营只看到「用户点了确认却没动静」，不知道卡片早已终结。
  const unfinishedActions = (input.actions ?? []).filter((action) =>
    ['CANCELLED', 'FAILED', 'EXPIRED'].includes(action.status),
  );
  if (unfinishedActions.length > 0) {
    const latest = unfinishedActions[unfinishedActions.length - 1];
    flags.push({
      key: 'action_unfinished',
      label: '确认卡片动作未完成',
      detail: `${latest.action} 状态 ${latest.status}${
        latest.error ? `：${latest.error}` : ''
      }`,
      severity: latest.status === 'FAILED' ? 'high' : 'medium',
    });
  }

  if (!input.hasTrace) {
    flags.push({
      key: 'no_trace',
      label: '本会话没有链路追踪',
      detail: '看不到意图、RAG 与模型节点，无法继续定位',
      severity: 'medium',
    });
  }

  return {
    unanswered,
    lastUserMessageAt,
    idleMinutes,
    sensitiveRequest,
    languageMismatch,
    intentFlowMismatch,
    hasTrace: input.hasTrace,
    flags,
  };
}

function formatWait(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时 ${minutes % 60} 分钟`;
  return `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`;
}
