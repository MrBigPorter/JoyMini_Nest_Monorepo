/**
 * 知识兜底判定：当所有 Agent 都返回“不在我范围/无法处理”这类拒绝，
 * 而用户问的是流程/规则/政策类信息题时，改用知识库回答。
 *
 * 只处理信息题；动作请求（提现、领券、下单）不走这里。
 */
const INFORMATIONAL =
  /(怎么|如何|流程|步骤|规则|政策|多久|多长时间|能不能|可不可以|怎样|在哪里|哪里看)/;

const SCOPE_REFUSAL =
  /(不在我的服务范围|不在我负责|不在我的?职责|无法为您处理|无法处理|我这边只能|请使用对应的?功能|请使用.{0,8}查询功能|只能.{0,8}(搜索|浏览|查询)|没有直接的信息|没有相关的?信息|不方便.{0,6}(准确|指引)|怕说错|怕误导|建议.{0,10}(联系人工客服|帮助中心|页脚)|页面底部找到|没有(直接)?(查看|调取|解释)|没有权限.{0,8}(查看|解释|查询))/;

export function shouldUseKnowledgeFallback(
  userInput: string,
  outputs: Array<{ content: string }>,
): boolean {
  if (outputs.length === 0) return false;
  if (!INFORMATIONAL.test(userInput)) return false;
  return outputs.every((output) => SCOPE_REFUSAL.test(output.content));
}
