# Groq 429 翻译连锁失败修复方案 (v2)

## 问题概述

部署第一轮修复后，从日志确认：

1. ✅ **修改1生效**: `Groq key ...XfeN hit 429, blocking key for 7409s (3 other keys still available)` — 只封单个 Key
2. ❌ **修改2未生效**: 因为 `translateWithRetry()` 在 `isAvailable()` 检查阶段就抛错了，**根本没走到 catch 块**

### 新日志分析

```
[WARN] ⚠️ Groq key ...XfeN hit 429, blocking key for 7409s (3 other keys still available)
[WARN] ⛔ [Groq] strict mode: all keys exhausted, skip fallback
[ERROR] 批量翻译失败 (尝试 1/3)
[ERROR] Object(3) { error: 'AI service returned empty result', articleId: 'cmon125we...', targetLang: 'ko' }
```

### 暴露的 3 个新问题

| # | 问题 | 文件 | 严重性 |
|---|------|------|--------|
| 1 | `retry-after = 7409秒`（2小时+）未被限制，导致 Key 被封太久 | `groq.provider.ts` | 高 |
| 2 | `batchTranslateArticle()` 捕获 `"AI service returned empty result"` 后**立即回退到传统翻译**，没有等待 | `blog-ai.processor.ts` 第506行 | 高 |
| 3 | `translateWithRetry()` 的 `isAvailable()` 检查（第156行）**直接抛错**，不等待，导致新增的 120s catch 块**永远执行不到** | `blog-ai.processor.ts` 第156行 | 高 |

---

## 修改 1: 限制 retry-after 最大冷却时间

**文件**: [`apps/api/src/common/ai/providers/groq.provider.ts`](apps/api/src/common/ai/providers/groq.provider.ts:178-180)

**问题**: Groq API 返回的 `retry-after` 头可能是 `7409`（2小时+），代码直接使用这个值作为冷却时间，导致 Key 被封数小时。

**代码变更**:

```typescript
// 当前代码（第178-180行）
const cooldownMs = retryAfter
  ? parseInt(retryAfter, 10) * 1000
  : this.KEY_429_COOLDOWN_DEFAULT;

// 修改为
const parsedRetryAfter = retryAfter ? parseInt(retryAfter, 10) * 1000 : 0;
const cooldownMs = parsedRetryAfter > 0
  ? Math.min(parsedRetryAfter, this.KEY_429_COOLDOWN_DEFAULT * 3) // 最大360秒（6分钟）
  : this.KEY_429_COOLDOWN_DEFAULT;
```

**效果**:
| retry-after | 改之前 | 改之后 |
|-------------|--------|--------|
| 无 | 120s | 120s |
| 10s | 10s | 10s（合理值，保留） |
| 7409s（2h+） | 7409s ❌ | 360s ✅ |

---

## 修改 2: `translateWithRetry()` 的 `isAvailable()` 改为等待而不是立即抛错

**文件**: [`apps/api/src/blog/processors/blog-ai.processor.ts`](apps/api/src/blog/processors/blog-ai.processor.ts:155-160)

**问题**: 当所有 Key 耗尽时，`isAvailable()` 返回 false，`translateWithRetry()` 第156行立即抛错。导致后续 120s 等待的 catch 块**永远执行不到**。

**当前流程**:
```
translateWithRetry()
  → isAvailable() == false  ← 直接抛错，不等待
  → 根本不会调用 translateText()
  → 不会进入 catch 块
  → 新增的120s等待逻辑失效
```

**修改方案**: 当 `isAvailable()` 为 false 时，等待 120s 后再检查，而不是直接抛错。

```typescript
// 当前代码（第155-160行）
if (!this.aiService.isAvailable()) {
  throw new Error(`翻译失败：AI服务不可用（目标语言 ${targetLang}，文本长度 ${text.length}）`);
}

// 修改为
if (!this.aiService.isAvailable()) {
  this.logger.warn(
    `⚠️ AI服务当前不可用（Groq Key可能已耗尽），等待 120s 后自动重试...`,
    { targetLang, textLength: text.length },
  );
  await new Promise((resolve) => setTimeout(resolve, 120000));
  // 等待后再次检查
  if (!this.aiService.isAvailable()) {
    this.logger.warn(
      `⌛ AI服务等待超时：120s后仍不可用（目标语言 ${targetLang}），抛出错误`,
    );
    throw new Error(
      `翻译失败：AI服务不可用（目标语言 ${targetLang}，文本长度 ${text.length}）`,
    );
  }
}
```

---

## 修改 3: `batchTranslateArticle()` catch 块增加 Key 耗尽等待

**文件**: [`apps/api/src/blog/processors/blog-ai.processor.ts`](apps/api/src/blog/processors/blog-ai.processor.ts:506-527)

**问题**: `batchTranslateArticle()` 调用 `generateText()` 直接（不是 `translateText()`），返回 null 时抛出 `"AI service returned empty result"`。catch 块（第506行）立即回退到传统翻译，没有等待 Key 恢复。

**当前流程**:
```
batchTranslateArticle()
  → generateText() 返回 null（所有 Key 耗尽 + strict 模式）
  → 抛出 "AI service returned empty result"
  → catch 块：直接回退到传统翻译
  → fallbackToTraditionalTranslation() → translateWithRetry()
  → isAvailable() 为 false → 立即抛错（即使修改2加了等待，也只是多等120s）
```

**修改方案**: 在 catch 块中检测 Key 耗尽错误，等待 120s 后重试。

```typescript
// 在 catch 块（第506行）中，日志记录之前，增加以下逻辑：

} catch (error) {
  lastError = error;

  // === 新增：Key 耗尽检测 ===
  const isKeysExhausted =
    error instanceof Error &&
    (error.message.includes('AI service returned empty result') ||
     error.message.includes('AI returned null'));

  if (isKeysExhausted) {
    const waitMs = 120000;
    this.logger.warn(
      `⚠️ Groq API 所有 Key 已暂时耗尽，等待 ${waitMs / 1000}s 后自动重试...`,
      { attempt: attempt + 1, maxRetries: maxRetries + 1, targetLang },
    );
    await new Promise((resolve) => setTimeout(resolve, waitMs));

    if (attempt < maxRetries) {
      continue; // 继续重试，不要回退到传统翻译
    }
    // 最后一次尝试也耗尽 → 回退到传统翻译（原有逻辑）或返回原文
    this.logger.warn('⌛ 批量翻译等待超时：所有 Groq Key 仍不可用，回退到传统翻译方法');
  }
  // === Key 耗尽检测结束 ===

  this.logger.error(
    `批量翻译失败 (尝试 ${attempt + 1}/${maxRetries + 1})`,
    {
      error: error instanceof Error ? error.message : 'Unknown error',
      articleId: article.id,
      targetLang,
    },
  );

  // 如果是最后一次尝试，或 AI 已不可用，回退到传统方法
  if (attempt === maxRetries || (!isKeysExhausted && !this.aiService.isAvailable())) {
    this.logger.warn('批量翻译失败，回退到传统翻译方法');
    return await this.fallbackToTraditionalTranslation(
      sourceTitle,
      sourceContent,
      sourceExcerpt,
      targetLang,
    );
  }
}
```

**注意**: 需要调整第518行的回退条件，当 `isKeysExhausted` 为 true 时，即使 `!isAvailable()` 也不要回退（因为等待后可能恢复）。只有非 Key 耗尽错误且 AI 不可用时才回退。

---

## 完整修复流程对比

### 修改2+3生效后的正确流程

```
Job 翻译文章
  → batchTranslateArticle() 尝试批量翻译
  → generateText() 返回 null（全部 Key 耗尽）
  → [修改3] 检测 "AI service returned empty result"
  → 日志: "⚠️ Groq API 所有 Key 已暂时耗尽，等待 120s 后自动重试..."
  → 等待 120 秒
  → unblockExpiredKeys() 每秒检查 → 120s 后 Key 解封
  → 重试 generateText() → 成功 ✓
```

```
如果 120s 后仍未解封（fallback 到传统翻译）:
  → fallbackToTraditionalTranslation() → translateWithRetry()
  → [修改2] isAvailable() 为 false → 等待 120s → 再检查
  → 如果恢复 → 翻译成功 ✓
  → 如果仍未恢复 → 抛错 → 返回原文
  → 返回原文（安全，下次重新处理）
```

---

## 执行顺序

| # | 操作 | 文件 | 说明 |
|---|------|------|------|
| 1 | 限制 retry-after 最大 360s | `groq.provider.ts:178-180` | 防止单 Key 被封数小时 |
| 2 | `translateWithRetry()` isAvailable() 改为等待 | `blog-ai.processor.ts:155-160` | 让 120s catch 块能执行到 |
| 3 | `batchTranslateArticle()` catch 块增加等待 | `blog-ai.processor.ts:506-527` | 批量路径也等待，不立即回退 |

## 验证方法

1. 部署后观察日志：429 出现时 `retry-after` 被限制（不超过 360s）
2. 观察日志：所有 Key 耗尽时出现 "等待 120s 后自动重试" 提示
3. 确认等待后 Key 恢复，翻译自动成功
4. 确认不再出现 "批量翻译失败" + "AI service returned empty result" 的连续报错
