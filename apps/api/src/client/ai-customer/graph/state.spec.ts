/**
 * Unit tests for AgentState flowData reducer and cross-business isolation logic
 *
 * Tests the 3-branch reducer logic that prevents the `Object.keys(undefined)` crash
 * and correctly handles:
 *   - undefined/null → keep existing data (agent didn't use flow tools)
 *   - {} empty object → clear data (topic switch detected)
 *   - {key: val} → merge into existing (normal slot filling)
 */
import { AgentState } from './state';

// ================================================================
// flowDataReducer — exact copy of the logic in state.ts
// ================================================================
function flowDataReducer(
  a: Record<string, any>,
  b: Record<string, any>,
): Record<string, any> {
  // undefined/null = node didn't specify flowData, keep existing
  if (b == null) return a;
  // empty object = explicit clear (intentRouter on topic switch)
  if (Object.keys(b).length === 0) return {};
  // normal merge (agent filling data via updateFlowData tool)
  return { ...a, ...b };
}

// ================================================================
// FLOWTYPE_DOMAIN — exact copy of the mapping in intent-router.node.ts
// ================================================================
const FLOWTYPE_DOMAIN: Record<string, string> = {
  WITHDRAWAL: 'wallet',
  DEPOSIT: 'wallet',
  BALANCE_QUERY: 'wallet',
  COUPON_QUERY: 'coupon',
  COUPON_CLAIM: 'coupon',
  ORDER_QUERY: 'order',
  POLICY: 'rag',
  GENERAL: 'general',
};

/**
 * Simulated intent-to-flowType mapping (subset of intentToFlowType)
 */
function intentToFlowType(intent: string): string | null {
  const map: Record<string, string> = {
    withdrawal: 'WITHDRAWAL',
    deposit: 'DEPOSIT',
    balance_query: 'BALANCE_QUERY',
    coupon_query: 'COUPON_QUERY',
    coupon_claim: 'COUPON_CLAIM',
    order_query: 'ORDER_QUERY',
    policy: 'POLICY',
    general: 'GENERAL',
  };
  return map[intent] ?? null;
}

/**
 * Simulated isTopicSwitch logic (exact copy from intent-router.node.ts)
 */
function calcIsTopicSwitch(
  currentFlowType: string | undefined,
  newIntent: string,
): boolean {
  const currentDomain = currentFlowType
    ? FLOWTYPE_DOMAIN[currentFlowType]
    : '';
  const matchedFlowType = intentToFlowType(newIntent);
  const newDomain = matchedFlowType ? FLOWTYPE_DOMAIN[matchedFlowType] : '';
  return (
    currentDomain !== '' && newDomain !== '' && currentDomain !== newDomain
  );
}

// ================================================================
// Tests: flowDataReducer
// ================================================================
describe('flowDataReducer', () => {
  // ---------- Branch 1: b == null → keep existing ----------
  it('should keep existing data when b is undefined (agent did not use flow tools)', () => {
    const existing = { amount: '100', wallet: '0xabc' };
    expect(flowDataReducer(existing, undefined as any)).toEqual(existing);
  });

  it('should keep existing data when b is null', () => {
    const existing = { amount: '100' };
    expect(flowDataReducer(existing, null as any)).toEqual(existing);
  });

  it('should keep empty object when a={} and b=undefined (first call, no data yet)', () => {
    expect(flowDataReducer({}, undefined as any)).toEqual({});
  });

  // ---------- Branch 2: b === {} → clear (topic switch) ----------
  it('should clear flowData when b is empty object (topic switch)', () => {
    const existing = { amount: '100', wallet: '0xabc' };
    expect(flowDataReducer(existing, {})).toEqual({});
  });

  it('should return empty object when both a and b are empty', () => {
    expect(flowDataReducer({}, {})).toEqual({});
  });

  // ---------- Branch 3: normal merge ----------
  it('should merge b into a when b has keys (normal slot filling)', () => {
    const existing = { amount: '100' };
    const incoming = { wallet: '0xabc' };
    expect(flowDataReducer(existing, incoming)).toEqual({
      amount: '100',
      wallet: '0xabc',
    });
  });

  it('should overwrite existing key when b has same key (updateFieldData)', () => {
    const existing = { amount: '100', status: 'pending' };
    const incoming = { amount: '200' };
    expect(flowDataReducer(existing, incoming)).toEqual({
      amount: '200',
      status: 'pending',
    });
  });

  it('should return b when a is empty (first data write)', () => {
    const incoming = { amount: '100' };
    expect(flowDataReducer({}, incoming)).toEqual(incoming);
  });

  // ---------- Edge cases ----------
  it('should handle deeply nested objects (spread merge is shallow)', () => {
    const existing = { meta: { key: 'old' } };
    const incoming = { meta: { key: 'new' } };
    const result = flowDataReducer(existing, incoming);
    // Shallow merge means the entire `meta` is replaced
    expect(result).toEqual({ meta: { key: 'new' } });
  });

  it('should handle multiple sequential merges', () => {
    let state = {};
    state = flowDataReducer(state, { amount: '100' });
    state = flowDataReducer(state, { wallet: '0xabc' });
    state = flowDataReducer(state, { method: 'GCash' });
    expect(state).toEqual({
      amount: '100',
      wallet: '0xabc',
      method: 'GCash',
    });
  });

  it('should handle sequential: merge → clear → merge', () => {
    let state = {};
    state = flowDataReducer(state, { amount: '100' });
    state = flowDataReducer(state, { wallet: '0xabc' });
    // topic switch clears
    state = flowDataReducer(state, {});
    expect(state).toEqual({});
    // new business fills fresh data
    state = flowDataReducer(state, { couponCode: 'SAVE50' });
    expect(state).toEqual({ couponCode: 'SAVE50' });
  });

  it('should handle: merge → undefined (keep) → merge', () => {
    let state = {};
    state = flowDataReducer(state, { amount: '100' });
    // agent with no flow tools — should keep existing
    state = flowDataReducer(state, undefined as any);
    expect(state).toEqual({ amount: '100' });
    // subsequent merge still works
    state = flowDataReducer(state, { wallet: '0xabc' });
    expect(state).toEqual({ amount: '100', wallet: '0xabc' });
  });
});

// ================================================================
// Tests: FLOWTYPE_DOMAIN mapping
// ================================================================
describe('FLOWTYPE_DOMAIN', () => {
  it('should map WITHDRAWAL to wallet domain', () => {
    expect(FLOWTYPE_DOMAIN['WITHDRAWAL']).toBe('wallet');
  });

  it('should map DEPOSIT to wallet domain', () => {
    expect(FLOWTYPE_DOMAIN['DEPOSIT']).toBe('wallet');
  });

  it('should map BALANCE_QUERY to wallet domain', () => {
    expect(FLOWTYPE_DOMAIN['BALANCE_QUERY']).toBe('wallet');
  });

  it('should map COUPON_QUERY to coupon domain', () => {
    expect(FLOWTYPE_DOMAIN['COUPON_QUERY']).toBe('coupon');
  });

  it('should map COUPON_CLAIM to coupon domain', () => {
    expect(FLOWTYPE_DOMAIN['COUPON_CLAIM']).toBe('coupon');
  });

  it('should map ORDER_QUERY to order domain', () => {
    expect(FLOWTYPE_DOMAIN['ORDER_QUERY']).toBe('order');
  });

  it('should map POLICY to rag domain', () => {
    expect(FLOWTYPE_DOMAIN['POLICY']).toBe('rag');
  });

  it('should map GENERAL to general domain', () => {
    expect(FLOWTYPE_DOMAIN['GENERAL']).toBe('general');
  });

  it('should return undefined for unknown flowType', () => {
    expect(FLOWTYPE_DOMAIN['UNKNOWN']).toBeUndefined();
  });
});

// ================================================================
// Tests: isTopicSwitch logic
// ================================================================
describe('isTopicSwitch (cross-business detection)', () => {
  // -------- Same domain: NOT a topic switch --------
  it('should NOT switch: WITHDRAWAL → withdrawal (same wallet domain)', () => {
    expect(calcIsTopicSwitch('WITHDRAWAL', 'withdrawal')).toBe(false);
  });

  it('should NOT switch: WITHDRAWAL → deposit (same wallet domain)', () => {
    expect(calcIsTopicSwitch('WITHDRAWAL', 'deposit')).toBe(false);
  });

  it('should NOT switch: WITHDRAWAL → balance_query (same wallet domain)', () => {
    expect(calcIsTopicSwitch('WITHDRAWAL', 'balance_query')).toBe(false);
  });

  it('should NOT switch: COUPON_QUERY → coupon_claim (same coupon domain)', () => {
    expect(calcIsTopicSwitch('COUPON_QUERY', 'coupon_claim')).toBe(false);
  });

  // -------- Different domain: IS a topic switch --------
  it('should switch: WITHDRAWAL → coupon_query (wallet → coupon)', () => {
    expect(calcIsTopicSwitch('WITHDRAWAL', 'coupon_query')).toBe(true);
  });

  it('should switch: COUPON_QUERY → order_query (coupon → order)', () => {
    expect(calcIsTopicSwitch('COUPON_QUERY', 'order_query')).toBe(true);
  });

  it('should switch: ORDER_QUERY → withdrawal (order → wallet)', () => {
    expect(calcIsTopicSwitch('ORDER_QUERY', 'withdrawal')).toBe(true);
  });

  it('should switch: WITHDRAWAL → policy (wallet → rag)', () => {
    expect(calcIsTopicSwitch('WITHDRAWAL', 'policy')).toBe(true);
  });

  it('should switch: COUPON_QUERY → general (coupon → general)', () => {
    expect(calcIsTopicSwitch('COUPON_QUERY', 'general')).toBe(true);
  });

  // -------- Empty/no previous flowType: NOT a switch (first call) --------
  it('should NOT switch: no previous flowType → withdrawal (first call)', () => {
    expect(calcIsTopicSwitch(undefined, 'withdrawal')).toBe(false);
  });

  it('should NOT switch: no previous flowType → coupon_query (first call)', () => {
    expect(calcIsTopicSwitch(undefined, 'coupon_query')).toBe(false);
  });

  it('should NOT switch: empty string flowType → general (first call)', () => {
    expect(calcIsTopicSwitch('' as any, 'general')).toBe(false);
  });

  // -------- GENERAL domain edge cases --------
  it('should NOT switch: GENERAL → general (same general domain)', () => {
    expect(calcIsTopicSwitch('GENERAL', 'general')).toBe(false);
  });

  it('should switch: GENERAL → withdrawal (general → wallet)', () => {
    expect(calcIsTopicSwitch('GENERAL', 'withdrawal')).toBe(true);
  });
});

// ================================================================
// Integration tests: Full flow simulation
// ================================================================
describe('End-to-end: flowData lifecycle with topic switching', () => {
  it('Scenario A: withdrawal fill → coupon query (clear flowData)', () => {
    let flowData: Record<string, any> = {};

    // Round 1: User says "我要取款" — first call, no previous flowType
    // Intent router runs, isTopicSwitch=false, no flowData returned
    // Agent starts filling data via updateFlowData tool
    flowData = flowDataReducer(flowData, { amount: '100' });
    flowData = flowDataReducer(flowData, { wallet: '0xabc' });
    flowData = flowDataReducer(flowData, { method: 'GCash' });
    expect(flowData).toEqual({
      amount: '100',
      wallet: '0xabc',
      method: 'GCash',
    });

    // Round 2: User says "帮我查优惠券" — topic switch detected
    // Intent router detects: wallet domain → coupon domain = topic switch
    // Returns flowData: {} → reducer clears
    const isSwitch = calcIsTopicSwitch('WITHDRAWAL', 'coupon_query');
    expect(isSwitch).toBe(true);
    flowData = flowDataReducer(flowData, {});
    expect(flowData).toEqual({});

    // Round 3: Coupon agent runs, no flowData returned (undefined → keep)
    flowData = flowDataReducer(flowData, undefined as any);
    expect(flowData).toEqual({});
  });

  it('Scenario B: withdrawal → withdrawal (preserve flowData)', () => {
    let flowData: Record<string, any> = {};

    // Round 1: User starts withdrawal
    flowData = flowDataReducer(flowData, { amount: '100' });
    expect(flowData).toEqual({ amount: '100' });

    // Round 2: Same business, intent router runs
    // isTopicSwitch = false (wallet → wallet), no flowData returned
    // Agent also returns no flowData (undefined → keep)
    const isSwitch = calcIsTopicSwitch('WITHDRAWAL', 'withdrawal');
    expect(isSwitch).toBe(false);
    flowData = flowDataReducer(flowData, undefined as any);
    // flowData should be preserved (not cleared!)
    expect(flowData).toEqual({ amount: '100' });

    // Round 3: Agent fills more data
    flowData = flowDataReducer(flowData, { wallet: '0xabc' });
    expect(flowData).toEqual({ amount: '100', wallet: '0xabc' });
  });

  it('Scenario C: prevent Object.keys(undefined) crash', () => {
    // This is the exact crash from Docker logs:
    // TypeError: Cannot convert undefined or null to object
    //   at Function.keys (<anonymous>)
    //   at BinaryOperatorAggregate.reducer (state.ts:129:18)
    const existing = { amount: '100' };
    // If b is undefined (e.g., agent returned no flowData), this must NOT crash
    expect(() => flowDataReducer(existing, undefined as any)).not.toThrow();
    // Additionally, existing data must be preserved
    expect(flowDataReducer(existing, undefined as any)).toEqual(existing);
  });
});

// ================================================================
// Tests: pendingConfirmReducer
// ================================================================
// pendingConfirm 是"每轮一次性"字段：本轮生成确认就是对象，没生成就是 null。
// 关键：reducer 必须采用新值 b（null 就清空）—— 而不是 `b ?? a` 保留旧值。
// 如果保留旧值，上一轮的确认（如"领券"）会跨轮残留，导致下一轮
// "取款"误弹上一轮的领券确认卡片。
// 本 reducer 为 state.ts 中 pendingConfirm 字段 reducer 逻辑的镜像副本。
function pendingConfirmReducer(
  a: {
    action: string;
    params: Record<string, any>;
    summary: Record<string, any>;
  } | null,
  b: {
    action: string;
    params: Record<string, any>;
    summary: Record<string, any>;
  } | null,
) {
  return b;
}

describe('pendingConfirmReducer', () => {
  const couponConfirm = {
    action: 'claim_coupon',
    params: { couponId: 'c1' },
    summary: { action: 'claim_coupon', couponId: 'c1' },
  };

  it('should set pendingConfirm when b is a confirm object (领券 → claim_coupon)', () => {
    expect(pendingConfirmReducer(null, couponConfirm)).toEqual(couponConfirm);
  });

  it('should REPLACE old confirm when b is a new confirm object (取款 → withdraw)', () => {
    const withdrawConfirm = {
      action: 'withdraw',
      params: { amount: 100, channelId: 2 },
      summary: { action: 'withdraw', amount: 100, channelId: 2 },
    };
    expect(pendingConfirmReducer(couponConfirm, withdrawConfirm)).toEqual(
      withdrawConfirm,
    );
  });

  it('should CLEAR old confirm when b is null (本轮无确认 → 清空残留的领券卡)', () => {
    expect(pendingConfirmReducer(couponConfirm, null)).toBeNull();
  });

  it('should stay null when both a and b are null (连续两轮无确认)', () => {
    expect(pendingConfirmReducer(null, null)).toBeNull();
  });
});
