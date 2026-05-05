# DeepSeek Translation Speed Optimization Plan

## 问题

DeepSeek 付费 API **没有速率限制**，但 `AiService` 的全局 `RPM=12` / `TPM=800K` 限制（[`ai.service.ts:71`](../apps/api/src/common/ai/ai.service.ts:71)）导致 DeepSeek 也被限制在 12 次请求/分钟。

## 方案

**核心思路**：在 [`generateText()`](../apps/api/src/common/ai/ai.service.ts:363) 中，当主 provider 为 DeepSeek 时，**跳过共享限流检查**。Groq/Gemini 的 RPM=12/TPM=800K 保护完全不受影响。

## 修改清单

### 修改 1（🎯 核心）: [`AiService.generateText()`](../apps/api/src/common/ai/ai.service.ts:363) — DeepSeek 跳过 `checkPreConditions`

```typescript
async generateText(prompt, options?, requiredLevel?) {
    const config = await this.getProviderConfig();
    const primaryProvider = ...;
    
    // +++ 新增：DeepSeek 跳过共享限流（付费 API 无视 RPM/TPM）+++
    const isDeepSeek = config.provider === 'deepseek';
    if (!isDeepSeek) {
        if (!this.checkPreConditions(requiredLevel, estimatedTokens)) {
            return null;
        }
    }
    
    // 尝试主 provider
    if (primaryProvider.isAvailable()) {
        const result = await primaryProvider.generateText(prompt, options);
        if (result !== null) {
            if (!isDeepSeek) {           // +++ DeepSeek 不计入共享计数器 +++
                this.recordSuccess(estimatedTokens);
            }
            return result;
        }
    }
    
    // strict mode / fallback 逻辑不变 ...
}
```

**原理**：
- DeepSeek 路径：完全跳过 `checkPreConditions()` + 不调用 `recordSuccess()`
- Groq/Gemini 回退：仍受 RPM=12/TPM=800K 保护
- 断路器机制：仍然生效（`recordFailure()` 不变）

**翻译完关闭方式**：只需删除 `isDeepSeek` 相关代码即可恢复。

---

### 修改 2（辅助）: [`AiService.translateMarkdown()`](../apps/api/src/common/ai/ai.service.ts:728) — 提高分块阈值

| 参数 | 旧值 | 新值 |
|------|------|------|
| `MAX_SINGLE_CALL_CHARS` | 5000 | 20000 |

**原因**：DeepSeek 有 128K 上下文窗口，20000 字符内的大文章不必拆块。Groq 也有 32K 上下文，不受影响。

### 修改 3（辅助）: [`BlogAiProcessor`](../apps/api/src/blog/processors/blog-ai.processor.ts:359) — 提高批量回落阈值

| 参数 | 旧值 | 新值 |
|------|------|------|
| `MAX_BATCH_CONTENT_CHARS` | 10000 | 30000 |

**原因**：减少大文章回退到分块翻译的次数。

### 修改 4（辅助）: [`BlogAiProcessor`](../apps/api/src/blog/processors/blog-ai.processor.ts:18) — 提高队列限流

| 参数 | 旧值 | 新值 |
|------|------|------|
| `limiter.max` | 5 | 60 |

**原因**：队列吞吐量从 5 job/min 提高到 60 job/min。

### 修改 5（辅助）: [`BlogAiProcessor`](../apps/api/src/blog/processors/blog-ai.processor.ts:28) — 降低请求间隔

| 参数 | 旧值 | 新值 |
|------|------|------|
| `interRequestDelay` | 500ms | 50ms |

**原因**：DeepSeek 不需要 500ms 间隔，降至 50ms 防止突发即可。

## 回滚

翻译完成后，如需切回 Groq，只需：
1. 删除 `ai.service.ts` 中的 `isDeepSeek` 相关代码（约 5 行）
2. 将 `blog-ai.processor.ts` 各参数改回原值（队列限流 5、间隔 500ms、批量阈值 10000）
