/**
 * 工具事实提取（确定性）。
 *
 * 背景：agent-runner 的 ToolMessage 只活在一轮里，orchestrator 只把最终文本
 * 写回 state.messages。下一轮模型看不到 couponId / channelId，只能猜。
 * 这里把「模型下一轮真正需要的少量事实」从工具结果里挑出来，写进
 * contextState.slots，由 formatContextSummary 每轮注入。
 *
 * 只收白名单字段，避免把整份业务对象塞进上下文。
 */

export interface ToolCallInfo {
  name: string;
  args: Record<string, any>;
  result: string;
}

const MAX_LIST_ITEMS = 5;

interface ParsedResult {
  ok: boolean;
  data: any;
}

/** 兼容 toolSuccess 原始 JSON 与 stripToolResult 之后的裸 data。 */
function parseResult(raw: string): ParsedResult | null {
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      'ok' in parsed
    ) {
      return parsed.ok === true
        ? { ok: true, data: (parsed as any).data }
        : { ok: false, data: null };
    }
    return { ok: true, data: parsed };
  } catch {
    return null;
  }
}

interface CouponFact {
  couponId: unknown;
  couponName: unknown;
}

interface ChannelFact {
  channelId: unknown;
  channelName: unknown;
  feeRate: unknown;
  feeFixed: unknown;
}

function couponList(data: any): CouponFact[] {
  const list: any[] = Array.isArray(data)
    ? data
    : Array.isArray(data?.coupons)
      ? data.coupons
      : Array.isArray(data?.list)
        ? data.list
        : [];
  return list
    .slice(0, MAX_LIST_ITEMS)
    .map(
      (item: any): CouponFact => ({
        couponId: item?.couponId ?? item?.id,
        couponName: item?.couponName ?? item?.name,
      }),
    )
    .filter((item: CouponFact) => Boolean(item.couponId));
}

function channelList(data: any): ChannelFact[] {
  const list: any[] = Array.isArray(data) ? data : [];
  return list
    .slice(0, MAX_LIST_ITEMS)
    .map(
      (channel: any): ChannelFact => ({
        channelId: channel?.id ?? channel?.channelId,
        channelName: channel?.name ?? channel?.channelName,
        feeRate: channel?.feeRate,
        feeFixed: channel?.feeFixed,
      }),
    )
    .filter((channel: ChannelFact) => channel.channelId !== undefined);
}

/**
 * 把一次 agent 循环里的成功工具调用压成少量可注入事实。
 * 没有可提取事实时返回 null。
 */
export function collectToolFacts(
  calls: ToolCallInfo[] | null | undefined,
): Record<string, unknown> | null {
  if (!calls || calls.length === 0) return null;

  const facts: Record<string, unknown> = {};

  for (const call of calls) {
    const parsed = parseResult(call.result);
    if (!parsed?.ok) continue;

    switch (call.name) {
      case 'getClaimableCoupons': {
        const coupons = couponList(parsed.data);
        if (coupons.length > 0) facts.claimableCoupons = coupons;
        break;
      }
      case 'getUserCoupons': {
        const coupons = couponList(parsed.data);
        if (coupons.length > 0) facts.userCoupons = coupons;
        break;
      }
      case 'getPaymentChannels': {
        const channels = channelList(parsed.data);
        if (channels.length > 0) facts.withdrawChannels = channels;
        break;
      }
      case 'getWalletBalance': {
        if (parsed.data && typeof parsed.data === 'object') {
          facts.walletBalance = parsed.data;
        }
        break;
      }
      default:
        break;
    }
  }

  return Object.keys(facts).length > 0 ? facts : null;
}
