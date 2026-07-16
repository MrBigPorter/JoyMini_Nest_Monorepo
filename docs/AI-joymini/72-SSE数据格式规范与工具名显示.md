# SSE 数据格式规范与工具名显示优化

## 背景

AI 客服的 SSE 流存在两个问题：

1. **格式不一致** — `step` 事件用 `{ type, step, data: { content/tool } }`（嵌套），`token` 事件用 `{ type, content }`（扁平），Flutter 需要两种不同的解析路径
2. **工具名暴露** — `tool_start` 事件直接发 LangChain 内部工具名（如 `searchProducts`），用户看到的是 `正在查询 searchProducts...` 这样的机器名

## 改动

### 1. SSE 格式统一（扁平化）

**控制器** [ai-customer.controller.ts](../../apps/api/src/client/ai-customer/ai-customer.controller.ts)

之前 `sendSSE` 调用：

```typescript
// token — 扁平
sendSSE("token", { content: token }); // → {"type":"token","content":"..."}

// step — 嵌套
sendSSE("step", { step, data }); // → {"type":"step","step":"thinking","data":{"content":"..."}}
```

改为 `step` 也扁平：

```typescript
// step — 扁平（与 token 一致）
sendSSE("step", { step, ...data }); // → {"type":"step","step":"thinking","content":"..."}
```

#### 最终 SSE 事件格式

| 事件    | 格式                                                |
| ------- | --------------------------------------------------- |
| `token` | `{"type":"token","content":"..."}`                  |
| `step`  | `{"type":"step","step":"thinking","content":"..."}` |
| `step`  | `{"type":"step","step":"tool_start","tool":"..."}`  |
| `step`  | `{"type":"step","step":"tool_end"}`                 |
| `done`  | `{"type":"done"}`                                   |
| `error` | `{"type":"error","content":"..."}`                  |

所有事件统一为 `{ type, ...payload }` 结构，payload 直接展开在顶层，没有多余的嵌套。

### 2. 工具名显示优化（displayName）

**接口** [tool-registry.service.ts](../../apps/api/src/client/ai-customer/graph/tools/tool-registry.service.ts)

`TaggedTool` 新增可选字段：

```typescript
export interface TaggedTool {
  tool: DynamicStructuredTool;
  tags: string[];
  displayName?: string; // 用户友好描述，如 "Searching products..."
}
```

`ToolRegistryService` 在 `registerMany` 时自动建索引（`name → displayName`），提供 `getDisplayName(name)` 方法。

**服务** [ai-customer.service.ts](../../apps/api/src/client/ai-customer/ai-customer.service.ts)

`on_tool_start` 事件改用 displayName：

```typescript
else if (eventName === 'on_tool_start') {
  const displayName = this.registry.getDisplayName(name) ?? name;
  callbacks.onStep('tool_start', { tool: displayName });
}
```

所有工具在定义处指定 displayName（英文、用户友好的现在分词短语）：

| 工具名              | displayName                       |
| ------------------- | --------------------------------- |
| `getUserOrders`     | `Looking up your orders...`       |
| `getWalletBalance`  | `Checking your balance...`        |
| `searchProducts`    | `Searching products...`           |
| `getKycDetail`      | `Checking verification status...` |
| ...（共 35 个工具） |                                   |

### 3. 意图分类 LLM 输出过滤

**问题**：`streamEvents` 捕获图中所有 LLM 调用，包括 `intentRouter` 节点用 `chain.invoke()` 做 LLM fallback 分类。该 LLM 输出 JSON（如 `{"intent":"coupon","labels":[...]}`），本应被 `parseLLMOutput()` 解析后丢弃，但因 `streamEvents` 会为所有 LLM 调用发 `on_chat_model_stream` 事件，导致分类 JSON 泄漏到 token 流中。

**修复** [ai-customer.service.ts](../../apps/api/src/client/ai-customer/ai-customer.service.ts)：

```typescript
for await (const event of eventStream) {
  const { event: eventName, data, name, metadata } = event;

  if (eventName === "on_chat_model_stream") {
    const node = metadata?.langgraph_node as string | undefined;
    // 跳过意图分类阶段（intentGateway / intentRouter）的 LLM 输出
    if (node === "intentGateway" || node === "intentRouter") continue;

    const chunk = data?.chunk;
    if (chunk?.content) {
      callbacks.onToken(chunk.content);
    }
  }
  // ...
}
```

通过 `metadata.langgraph_node` 区分来源节点，只推送 `orchestrator`（实际回复用户）的 token。

### 4. Flutter 端简化

**ViewModel** `ai_chat_view_model.dart`

`_onSseEvent` 做一层展平（安全兜底，后端已扁平则无操作）：

```dart
case SseEventType.step:
  final flatData = Map<String, dynamic>.from(event.data);
  if (flatData['data'] is Map) {
    flatData.addAll(flatData['data'] as Map<String, dynamic>);
  }
  flatData.remove('data');
  _handleStepEvent(SseEvent(type: SseEventType.step, data: flatData));
  break;
```

`_handleStepEvent` 直接从顶层读取（不再 `event.data['data']?['tool']`）：

```dart
void _handleStepEvent(SseEvent event) {
  final step = event.data['step'] as String? ?? '';
  final tool = event.data['tool'] as String?;
  final content = event.data['data']?['content'] as String?;

  switch (step) {
    case 'thinking':
      state = state.copyWith(
        statusText: content ?? 'Analyzing your question...',
      );
    case 'tool_start':
      state = state.copyWith(
        statusText: tool ?? '',
      );
    case 'tool_end':
      state = state.copyWith(statusText: '');
  }
}
```

## 改动文件清单

**后端（NestJS）：**

- `apps/api/src/client/ai-customer/graph/tools/tool-registry.service.ts` — TaggedTool 接口 + displayName 索引
- `apps/api/src/client/ai-customer/graph/tools/coupon-tools.ts` — 4 个工具加 displayName
- `apps/api/src/client/ai-customer/graph/tools/flow-tools.ts` — 2 个工具加 displayName
- `apps/api/src/client/ai-customer/graph/tools/kyc-tools.ts` — 2 个工具加 displayName
- `apps/api/src/client/ai-customer/graph/tools/lucky-tools.ts` — 7 个工具加 displayName
- `apps/api/src/client/ai-customer/graph/tools/order-tools.ts` — 2 个工具加 displayName
- `apps/api/src/client/ai-customer/graph/tools/product-tools.ts` — 5 个工具加 displayName
- `apps/api/src/client/ai-customer/graph/tools/user-tools.ts` — 6 个工具加 displayName
- `apps/api/src/client/ai-customer/graph/tools/wallet-tools.ts` — 7 个工具加 displayName
- `apps/api/src/client/ai-customer/ai-customer.controller.ts` — step 事件扁平化
- `apps/api/src/client/ai-customer/ai-customer.service.ts` — displayName 查询 + intent 输出过滤

**前端（Flutter）：**

- `lib/core/store/ai_chat/ai_chat_view_model.dart` — 展平处理 + 直接显示
