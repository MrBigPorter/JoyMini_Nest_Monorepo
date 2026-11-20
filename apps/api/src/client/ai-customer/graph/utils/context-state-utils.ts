import {
  ConversationContextState,
  emptyContextState,
} from '@api/client/ai-customer/graph/state';

const MAX_CORRECTIONS = 5;
const MAX_ENTITY_CHARS = 20;

/**
 * 更新对话内结构化状态。
 *
 * 优先级：明确纠正 > 新实体 > 保持原状。
 * 纠正时覆盖 activeEntity，并把旧实体记入 corrections，避免两个实体并列。
 * 返回 clarification 时，调用方应先问用户，不执行 Agent。
 */
export function updateContextState(
  previous: ConversationContextState | undefined,
  userInput: string,
): {
  state: ConversationContextState;
  clarification?: string;
} {
  const prev = previous ?? emptyContextState();
  const text = (userInput ?? '').trim();
  if (!text) return { state: { ...prev } };

  const correction = detectCorrection(text);
  if (correction) {
    const corrections = [
      ...prev.corrections,
      { ...correction, at: Date.now() },
    ].slice(-MAX_CORRECTIONS);
    return {
      state: {
        ...prev,
        activeEntity: correction.to,
        corrections,
        unresolved: [
          ...prev.unresolved.filter((item) => !item.includes(correction.to)),
          `确认用户当前要找的是${correction.to}`,
        ].slice(-5),
      },
    };
  }

  // 用户提到曾经被纠正掉的旧实体，而当前实体是另一个 → 先澄清，不猜。
  const stale = findReferencedStaleEntity(text, prev);
  if (stale) {
    return {
      state: { ...prev },
      clarification:
        `你之前把「${stale.from}」改成了「${stale.to}」。` +
        `现在说的「${stale.from}」是指之前那个，还是另一个？`,
    };
  }

  const entity = detectEntity(text);
  if (entity && entity !== prev.activeEntity) {
    return {
      state: {
        ...prev,
        activeEntity: entity,
        unresolved: prev.unresolved.slice(-4),
      },
    };
  }

  return { state: { ...prev } };
}

/**
 * 检测显式改口：
 *   不是苹果手机，是包包
 *   我说的是包包
 *   不对，是包包
 */
export function detectCorrection(
  text: string,
): { from: string; to: string } | null {
  const patterns: RegExp[] = [
    /不是\s*([^\s，,。；;？?]{1,20})\s*[，,。；;\s]*(?:而是|是|改成|换成)\s*([^\s，,。；;？?]{1,20})/,
    /(?:我说的是|我是说|不对[，,]?\s*(?:是)?)\s*([^\s，,。；;？?]{1,20})/,
  ];

  const match = patterns[0].exec(text);
  if (match) {
    return normalizeCorrection(match[1], match[2]);
  }

  const single = patterns[1].exec(text);
  if (single) {
    const to = cleanEntity(single[1]);
    if (!to) return null;
    return { from: '', to };
  }

  return null;
}

/**
 * 识别“我的苹果手机去哪里了”里的实体。
 * 没有中文分词，只取「我的/我那个/我买的」后面到动词/语气词之前的部分。
 */
export function detectEntity(text: string): string {
  const patterns: RegExp[] = [
    /(?:我的|我那个|我买的)\s*([^\s，,。；;？?]{1,20}?)(?:去|在|到|怎么|呢|丢|不见|找不到|查|是|有)/,
    /^([^\s，,。；;？?]{1,20}?)(?:去|在|到|怎么|呢|丢|不见|找不到)/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      const entity = cleanEntity(match[1]);
      if (entity) return entity;
    }
  }
  return '';
}

/**
 * 当前有效实体是 to，但用户这轮又提到旧的 from（如纠正为包包后说“说说手机”）。
 */
function findReferencedStaleEntity(
  text: string,
  state: ConversationContextState,
): { from: string; to: string } | null {
  if (!state.activeEntity) return null;
  for (const correction of [...state.corrections].reverse()) {
    if (!correction.from || correction.to !== state.activeEntity) continue;
    if (text.includes(state.activeEntity)) continue;

    const tokens = referencedTokens(correction.from);
    if (tokens.some((token) => text.includes(token))) {
      return correction;
    }
  }
  return null;
}

/** “苹果手机” → [苹果手机, 手机]；只保留 2 字以上，避免单字误命中。 */
function referencedTokens(entity: string): string[] {
  const tokens = new Set<string>([entity]);
  if (entity.length > 2) tokens.add(entity.slice(-2));
  return [...tokens].filter((token) => token.length >= 2);
}

function normalizeCorrection(
  fromRaw: string,
  toRaw: string,
): { from: string; to: string } | null {
  const from = cleanEntity(fromRaw);
  const to = cleanEntity(toRaw);
  if (!to) return null;
  return { from, to };
}

function cleanEntity(value: string | undefined): string {
  if (!value) return '';
  return value
    .replace(/^(?:一个|那个|这个|是|的)+/g, '')
    .replace(/(?:了|的|吧|啊|呢|吗)+$/g, '')
    .slice(0, MAX_ENTITY_CHARS)
    .trim();
}
