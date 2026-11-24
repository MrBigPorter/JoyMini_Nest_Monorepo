/**
 * 知识兜底判定：当所有 Agent 都返回“不在我范围/无法处理”这类拒绝，
 * 而用户问的是流程/规则/政策类信息题时，改用知识库回答。
 *
 * 只处理信息题；动作请求（提现、领券、下单）不走这里。
 */
/**
 * 信息类问题判定 —— 全链路唯一事实来源。
 *
 * 用途有三处：知识兜底、强制检索、连续失败计数。任何一处都不应该
 * 再自己写一份正则，否则「什么算信息题」会在不同出口给出不同答案。
 *
 * 为什么英文标记不写成裸 `what|how`：`how` 会命中 `show`，
 * `what` 会把所有英文问句都吞进来；这里只保留带功能词的组合。
 */
export const INFORMATIONAL = new RegExp(
  [
    // 中文
    '怎么|如何|流程|步骤|规则|政策|多久|多长时间|几天|几点|什么时候',
    '哪些|什么材料|需要什么|要准备',
    '能不能|可不可以|可以吗|是否|怎样|在哪里|哪里看',
    // 英文（必须带功能词，避免 show / what 这类误命中）
    '\\bhow (do|can|to|long|much|many|should)\\b',
    '\\bwhat (is|are|should|happens|documents?|materials?)\\b',
    '\\bwhere (can|do|is|are)\\b',
    '\\bwhich\\b',
    '\\bwhen (will|can|does|is)\\b',
    '\\bdo i need\\b',
    '\\bis there\\b',
    '\\bare there\\b',
    '\\b(policy|policies|rules?|requirements?|fees?|charges?)\\b',
  ].join('|'),
  'i',
);

/** 用户这句话是不是在问「流程/规则/政策/材料」这类信息题。 */
export function isInformationalQuestion(userInput: string): boolean {
  return INFORMATIONAL.test(userInput);
}

/**
 * 哪些意图在回答信息类问题前必须先咨询知识库。
 *
 * 不含 `general`：寒暄和助手自述没有知识库可查，强制检索只会增加延迟。
 */
export const KNOWLEDGE_CONSULT_INTENTS: ReadonlySet<string> = new Set([
  'order',
  'wallet',
  'coupon',
  'user',
  'product',
  'lucky-draw',
  'kyc',
  'rag',
]);

/** 业务域/知识意图 + 信息类问句 → 回答前必须先检索知识库。 */
export function shouldConsultKnowledge(
  intent: string | undefined,
  userInput: string,
): boolean {
  if (!intent || !KNOWLEDGE_CONSULT_INTENTS.has(intent)) return false;
  return isInformationalQuestion(userInput);
}

export const SCOPE_REFUSAL =
  /(不在我的服务范围|不在我负责|不在我的?职责|无法为您处理|无法处理|我这边只能|请使用对应的?功能|请使用.{0,8}查询功能|只能.{0,8}(搜索|浏览|查询)|没有直接的信息|没有相关的?信息|不方便.{0,6}(准确|指引)|怕说错|怕误导|建议.{0,10}(联系人工客服|帮助中心|页脚)|页面底部找到|没有(直接)?(查看|调取|解释)|没有权限.{0,8}(查看|解释|查询))/;

export function shouldUseKnowledgeFallback(
  userInput: string,
  outputs: Array<{ content: string }>,
): boolean {
  if (outputs.length === 0) return false;
  if (!isInformationalQuestion(userInput)) return false;
  return outputs.every((output) => SCOPE_REFUSAL.test(output.content));
}
