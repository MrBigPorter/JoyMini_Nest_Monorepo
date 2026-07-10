# 意图路由 Score Gap Check — Spec

## 1. 问题背景

当前意图分类存在两个问题：

**问题 A：多标签无差别执行**
用户输入 `"How do I withdraw funds?"`（英文）→ [`intent-classifier.ts`](apps/api/src/client/ai-customer/graph/utils/intent-classifier.ts:200-211) 返回 `rag=1.00, wallet=0.83`。rag 明显胜出（差距 0.17），但 [`orchestrator.node.ts:546-548`](apps/api/src/client/ai-customer/graph/nodes/orchestrator.node.ts:546-548) 仍然执行了 walletAgent，查了用户余额和 KYC，给用户不必要的回复。

**问题 B：低分噪音标签被执行**
用户问了一句闲聊（如"今天天气真不错"），所有 domain 得分都在 0.5 以下，但 gap 可能很大，导致低分标签被错误执行。

## 2. 根因分析

[`orchestrator.node.ts:546-548`](apps/api/src/client/ai-customer/graph/nodes/orchestrator.node.ts:546-548) 的当前逻辑：

```typescript
const sortedLabels = [...labels].sort((a, b) => b.score - a.score);
const labelNames = sortedLabels.map((l) => l.label);
const executionOrder = resolveExecutionOrder(labelNames);
// 所有 ≥ 0.5 的标签都执行，没有分数差距判断
```

缺少两层过滤：
1. **绝对分数底线** — 没有 MIN_SCORE，低分标签也能被 gap 判定选中
2. **分数差距检查** — 没有 gap threshold，top-1 明显胜出时仍执行所有标签

## 3. 解决方案：Score Gap Check

### 3.1 核心逻辑

在 [`orchestrator.node.ts:546`](apps/api/src/client/ai-customer/graph/nodes/orchestrator.node.ts:546) 的排序之后、[`resolveExecutionOrder()`](apps/api/src/client/ai-customer/graph/nodes/orchestrator.node.ts:548) 之前，加入两层过滤：

```
pgvector 返回 labels（domain + score）
     │
     ▼
Step 1: MIN_SCORE 过滤（≥ 0.65）
     │ 去掉绝对分数太低的"噪音"标签
     │ 例: order=0.50, product=0.30 → 去掉
     ▼
Step 2: Gap Check
     ├─ gap ≥ 0.15 → 只执行 top-1（明确主意图）
     └─ gap < 0.15 → 保留差距内的候选者（多意图模糊）
     ▼
resolveExecutionOrder(有效标签)
```

### 3.2 阈值说明

| 阈值 | 值 | 作用 | 依据 |
|------|----|------|------|
| `MIN_SCORE` | 0.65 | 绝对分数及格线 | intent-classifier.ts 已有 0.5 的"最低考虑线"，0.65 是"有信心执行"线 |
| `SCORE_GAP` | 0.15 | 分数差距阈值 | 差距超过 0.15 说明 top-1 明显胜出 |

> 两个阈值可根据实际数据调优，先以固定值实现，后续可改为可配置。

### 3.3 三路分支

```
if (validLabels.length === 0):
  → 走 generalChat fallback（已有逻辑）

if (validLabels.length === 1):
  → 直接执行该标签

if (validLabels.length >= 2):
  ├─ gap ≥ SCORE_GAP → 只执行 top-1 ✅
  └─ gap < SCORE_GAP → 只保留与 top-1 差距 < SCORE_GAP 的标签 🟡
```

**🟡 模糊分支的 close-contenders 策略**：

当 gap < 0.15 时，不是保留全部标签，而是只保留与 top-1 差距在 gap 之内的"紧密竞争者"。例如：

```
rag=0.90, wallet=0.88, order=0.50, product=0.30
gap = 0.02 < 0.15 → 保留 [rag, wallet]，去掉 order 和 product
```

这防止了"尾部标签污染"——分数断层的标签不应该因为 top-1 和 top-2 模糊就被连带执行。

## 4. 受影响的文件

| 文件 | 改动 |
|------|------|
| [`orchestrator.node.ts:546-548`](apps/api/src/client/ai-customer/graph/nodes/orchestrator.node.ts:546-548) | 加 MIN_SCORE 过滤 + Gap Check + close-contenders 截断 |
| [`intent-examples/rag.ts`](apps/api/src/client/ai-customer/graph/agents/prompts/intent-examples/rag.ts) | 可选：加流程相关的英文例句（如 "What is the withdrawal process?"） |

## 5. 实现代码

### 5.1 orchestrator.node.ts 修改

替换第 546-548 行：

```typescript
// ================================================================
// 2. 排序 + Score Gap Check
// ================================================================

const MIN_SCORE = 0.65; // 绝对分数及格线
const SCORE_GAP = 0.15; // 分数差距阈值

// Step 1: 按分数降序排列
const sortedLabels = [...labels].sort((a, b) => b.score - a.score);

// Step 2: MIN_SCORE 过滤 — 去掉低分噪音标签
const validLabels = sortedLabels.filter((l) => l.score >= MIN_SCORE);

let effectiveLabels: string[] = [];

if (validLabels.length === 0) {
  // 没有标签达到 MIN_SCORE → fallback 到 generalChat（走已有逻辑）
  logger.log(
    `[orchestrator] no labels above MIN_SCORE (${MIN_SCORE}), ` +
    `falling back to general chat`,
  );
  // 这里不直接 return，让流水线循环走空 labels 的 generalChat 处理
} else if (validLabels.length === 1) {
  // 只有一个标签及格，直接执行
  effectiveLabels = [validLabels[0].label];
  logger.log(
    `[orchestrator] single label above MIN_SCORE: ${effectiveLabels[0]}`,
  );
} else {
  // 多个标签及格 → Gap Check
  const topScore = validLabels[0].score;
  const gap = topScore - validLabels[1].score;

  if (gap >= SCORE_GAP) {
    // top-1 明显胜出，只执行它
    effectiveLabels = [validLabels[0].label];
    logger.log(
      `[orchestrator] gap ${gap.toFixed(2)} >= ${SCORE_GAP}, ` +
      `only executing: ${effectiveLabels[0]}`,
    );
  } else {
    // 模糊：只保留与 top-1 分差在 SCORE_GAP 内的候选者
    const closeContenders = validLabels.filter(
      (l) => topScore - l.score < SCORE_GAP,
    );
    effectiveLabels = closeContenders.map((l) => l.label);
    logger.log(
      `[orchestrator] ambiguous intent (gap=${gap.toFixed(2)}), ` +
      `close contenders: ${effectiveLabels.join(', ')}`,
    );
  }
}

const executionOrder = resolveExecutionOrder(effectiveLabels);
```

### 5.2 日志格式

每条 Gap Check 决策都要有清晰的结构化日志：

```
[orchestrator] gap 0.17 >= 0.15, only executing: rag
[orchestrator] ambiguous intent (gap=0.02), close contenders: rag, wallet
[orchestrator] no labels above MIN_SCORE (0.65), falling back to general chat
```

## 6. 验收标准

| # | 场景 | 输入 | 期望行为 |
|---|------|------|---------|
| 1 | **明确主意图** | `"How do I withdraw?"` → rag=1.00, wallet=0.83 | gap=0.17 → 只执行 rag ✅ |
| 2 | **分数平局** | 中文匹配 → rag=0.77, wallet=0.77 | gap=0.00 → 保留两个 ✅ |
| 3 | **尾部截断** | rag=0.90, wallet=0.88, order=0.50 | gap=0.02 → 只保留 [rag, wallet] ✅ |
| 4 | **低分过滤** | "今天天气" → rag=0.45, wallet=0.35 | 全低于 0.65 → 走 generalChat ✅ |
| 5 | **单一及格** | 只有一个标签 ≥ 0.65 | 直接执行该标签 ✅ |

## 7. 测试要点

- `sortedLabels` 为空时不出错
- `validLabels` 只有一个标签时正确处理
- gap 恰好等于 SCORE_GAP 时（边界值）进入"明确"分支
- `resolveExecutionOrder` 接收空数组时降级到 generalChat
- 日志清晰可读，方便线上排查

## 8. 后续优化方向（本次不实现）

- 阈值可配置化（管理后台动态调整 MIN_SCORE 和 SCORE_GAP）
- 结合 `flowState.previousIntent` 给上一轮的意图额外加分
- 模糊分支可触发反问澄清（"请问您是想查看说明还是直接操作？"）
