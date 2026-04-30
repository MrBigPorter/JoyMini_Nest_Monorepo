---
title: 'Gemini AI 生产级集成：四层熔断降级与三重配额控制'
description: '深入解析 NestJS 项目中对 @google-cloud/vertexai (Gemini 2.5 Flash) 的生产级封装，涵盖四层服务等级降级系统、三重配额控制、熔断器模式与指数退避重试等核心实现'
tags:
  - NestJS
  - Gemini
  - AI
  - Circuit Breaker
  - Rate Limiting
  - Vertex AI
---

# Gemini AI 生产级集成：四层熔断降级与三重配额控制

## 1. 引言

在生产环境中集成 LLM（Large Language Model）API 面临三个核心矛盾：

1. **成本 vs 可用性**——免费配额有限（Gemini 2.5 Flash 每分钟 15 次请求、100 万 Token），超限后服务不可用
2. **可靠性 vs 体验**——LLM API 可能因网络抖动、配额耗尽、模型过载而失败，降级策略直接影响用户体验
3. **大请求 vs 小请求**——评论审核（高频率、低 token）和全文翻译（低频率、高 token）需要不同的资源分配策略

本文以 NestJS 项目中对 `@google-cloud/vertexai`（Gemini 2.5 Flash）的生产级封装为例，深入解析 **四层服务等级降级系统**、**三重配额控制** 和 **熔断器模式** 的实现。

## 2. 四层服务等级设计

服务等级（Service Level）是整个系统的核心，定义了在资源紧张时哪些功能优先保留，哪些可以降级。

### 2.1 等级定义

```typescript
export enum AiServiceLevel {
  FULL = 3,      // 全部功能可用
  ESSENTIAL = 2, // 仅核心功能（评论审核）
  MINIMAL = 1,   // 最低限度功能
  DISABLED = 0,  // 完全禁用
}
```

这四个等级对应了不同的业务场景：

| 等级 | 值 | 可用功能 | 触发条件 |
|------|-----|---------|---------|
| `FULL` | 3 | 全部：自动回复、翻译、评论审核 | 正常运行 |
| `ESSENTIAL` | 2 | 仅评论审核、核心安全能力 | RPM 超限 |
| `MINIMAL` | 1 | 极低优先级任务 | TPM 超限 |
| `DISABLED` | 0 | 无 | 熔断器开启 |

### 2.2 自动降级

降级是自动的，无需人工介入。在 [`checkRateLimit`](apps/api/src/common/ai/ai.service.ts:187) 方法中：

```typescript
private checkRateLimit(estimatedTokens: number): boolean {
  // 熔断开启 → 直接拒绝
  if (this.circuitBreaker.openUntil > Date.now()) {
    return false;
  }

  // RPM 超限 → 降级到 ESSENTIAL
  if (this.usageCounter.requests >= this.LIMITS.RPM) {
    if (this.serviceLevel > AiServiceLevel.ESSENTIAL) {
      this.serviceLevel = AiServiceLevel.ESSENTIAL;
      this.levelUpdatedAt = Date.now();
      this.logger.warn(`⚠️  RPM limit reached, downgraded to ESSENTIAL mode`);
    }
    return false;
  }

  // TPM 超限 → 降级到 MINIMAL
  if (this.usageCounter.tokens + estimatedTokens >= this.LIMITS.TPM) {
    if (this.serviceLevel > AiServiceLevel.MINIMAL) {
      this.serviceLevel = AiServiceLevel.MINIMAL;
      this.levelUpdatedAt = Date.now();
      this.logger.warn(`⚠️  TPM limit reached, downgraded to MINIMAL mode`);
    }
    return false;
  }

  return true;
}
```

关键设计点：**降级是单向的**——等级只能从高往低走，恢复由定时器负责。

### 2.3 自动恢复

每秒钟执行的 [`resetCounters`](apps/api/src/common/ai/ai.service.ts:88) 中包含了服务等级的自动恢复逻辑：

```typescript
private resetCounters() {
  const now = Date.now();

  // 每60秒重置计数器窗口
  if (now >= this.usageCounter.resetAt) {
    this.usageCounter.requests = 0;
    this.usageCounter.tokens = 0;
    this.usageCounter.resetAt = now + 60000;
  }

  // 每5分钟尝试恢复一级
  if (
    now - this.levelUpdatedAt > 300000 &&
    this.serviceLevel < AiServiceLevel.FULL
  ) {
    this.serviceLevel = Math.min(this.serviceLevel + 1, AiServiceLevel.FULL);
    this.levelUpdatedAt = now;
    this.logger.log(
      `🔄 AI service level recovered to: ${AiServiceLevel[this.serviceLevel]}`,
    );
  }
}
```

恢复策略是**阶梯式递增**：每 5 分钟尝试恢复一级，从 `DISABLED(0)` → `MINIMAL(1)` → `ESSENTIAL(2)` → `FULL(3)`，整个过程最多需要 15 分钟。

## 3. 三重配额控制

在生产环境中，LLM API 调用必须防范三种超限风险。

### 3.1 配额阈值

```typescript
private readonly LIMITS = {
  RPM: 12,          // 每分钟最多12次（官方15，预留20%缓冲）
  TPM: 800000,      // 每分钟最多800k token（官方1M）
  DAILY: 800000,    // 每天最多800k token（官方1M）
  FAILURE_THRESHOLD: 5,   // 连续失败5次开启熔断
  CIRCUIT_BREAKER_DURATION: 900000, // 熔断15分钟
};
```

三个维度的配额控制：

| 维度 | 限制值 | 官方值 | 缓冲 | 超限后果 |
|------|--------|--------|------|---------|
| RPM (Requests Per Minute) | 12 | 15 | 20% | 降级到 ESSENTIAL |
| TPM (Tokens Per Minute) | 800,000 | 1,000,000 | 20% | 降级到 MINIMAL |
| Daily | 800,000 | 1,000,000 | 20% | — |

### 3.2 计数器实现

```typescript
private usageCounter = {
  requests: 0,
  tokens: 0,
  resetAt: Date.now() + 60000,  // 下一次重置时间戳
};
```

- `requests`：当前窗口内的请求次数
- `tokens`：当前窗口内的 Token 消耗估计
- `resetAt`：下一次重置的时间戳（每 60 秒重置一次）

Token 估算使用 `Math.ceil(prompt.length / 4) + maxOutputTokens`，即按 1 token ≈ 4 个字符粗略估算。

### 3.3 记录成功与失败

每次成功调用会累加计数器并重置连续失败计数：

```typescript
private recordSuccess(tokens: number) {
  this.usageCounter.requests++;
  this.usageCounter.tokens += tokens;
  this.circuitBreaker.consecutiveFailures = 0;
}
```

每次失败会增加连续失败计数，达到阈值后触发熔断：

```typescript
private recordFailure() {
  this.circuitBreaker.consecutiveFailures++;
  this.circuitBreaker.lastFailureAt = Date.now();

  if (
    this.circuitBreaker.consecutiveFailures >= this.LIMITS.FAILURE_THRESHOLD
  ) {
    this.circuitBreaker.openUntil =
      Date.now() + this.LIMITS.CIRCUIT_BREAKER_DURATION;
    this.serviceLevel = AiServiceLevel.DISABLED;
    this.logger.error(
      `🔥 Circuit breaker OPENED for 15 minutes after ${this.LIMITS.FAILURE_THRESHOLD} consecutive failures`,
    );
  }
}
```

## 4. 熔断器实现

熔断器（Circuit Breaker）是防止系统雪崩的关键模式。

### 4.1 状态定义

```typescript
private circuitBreaker = {
  consecutiveFailures: 0,
  openUntil: 0,      // 熔断开启截止时间戳
  lastFailureAt: 0,  // 最后失败时间
};
```

### 4.2 两种熔断场景

| 触发条件 | 熔断时长 | 服务等级 | 适用场景 |
|---------|---------|---------|---------|
| 连续 5 次失败 | 15 分钟 | `DISABLED` | API 不可用（认证错误、模型过载） |
| HTTP 429 (RESOURCE_EXHAUSTED) | 5 分钟 | `MINIMAL` | 配额耗尽（免费层超限） |

429 错误的特殊处理在 [`generateText`](apps/api/src/common/ai/ai.service.ts:240) 的内部 catch 块中：

```typescript
// 特殊处理429错误（资源耗尽）
if (e.code === 429 || e.status === 'RESOURCE_EXHAUSTED') {
  this.logger.warn(`⚠️  Vertex AI API 429 Resource Exhausted.`);

  // 立即降级服务等级
  if (this.serviceLevel > AiServiceLevel.MINIMAL) {
    this.serviceLevel = AiServiceLevel.MINIMAL;
    this.levelUpdatedAt = Date.now();
  }

  // 开启5分钟熔断
  this.circuitBreaker.openUntil = Date.now() + 300000;
}
```

### 4.3 熔断自动关闭

```typescript
if (
  this.circuitBreaker.openUntil > 0 &&
  now >= this.circuitBreaker.openUntil
) {
  this.circuitBreaker.openUntil = 0;
  this.circuitBreaker.consecutiveFailures = 0;
  this.logger.log('AI circuit breaker closed, service restored');
}
```

熔断关闭后，连续失败计数清零，服务等级通过阶梯恢复机制逐步回升。

## 5. 统一入口：`generateText`

所有 AI 功能通过 [`generateText`](apps/api/src/common/ai/ai.service.ts:240) 统一入口调用，实现关注点分离。

### 5.1 调用流程

```
generateText(prompt, options, requiredLevel)
  │
  ├─ 1. 服务是否启用？       → 否 → return null
  ├─ 2. 当前等级 ≥ requiredLevel？ → 否 → return null
  ├─ 3. 配额检查通过？       → 否 → return null
  ├─ 4. Gemini API 调用
  ├─ 5. 安全边界检查
  └─ 6. 记录成功/失败       → return text
```

```typescript
async generateText(
  prompt: string,
  options?: AiGenerationOptions,
  requiredLevel: AiServiceLevel = AiServiceLevel.FULL,
): Promise<string | null> {
  // 1. 基础检查
  if (!this.isEnabled || !this.geminiModel) return null;

  // 2. 服务等级检查
  if (this.serviceLevel < requiredLevel) return null;

  // 3. 配额检查
  const estimatedTokens = Math.ceil(prompt.length / 4) + (options?.maxOutputTokens || 512);
  if (!this.checkRateLimit(estimatedTokens)) return null;

  // 4. API 调用
  try {
    const result = await this.geminiModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: options,
    });
    // 5. 安全边界检查
    if (!result?.response?.candidates?.length) {
      this.recordFailure();
      return null;
    }
    // 6. 记录成功
    this.recordSuccess(estimatedTokens);
    return response.candidates[0]?.content?.parts?.[0]?.text || null;
  } catch (e) {
    this.recordFailure();
    // 429 特殊处理...
    return null;
  }
}
```

### 5.2 `requiredLevel` 的用途

每个业务功能声明自己需要的最低服务等级：

| 功能 | requiredLevel | 说明 |
|------|--------------|------|
| `moderateComment` | `ESSENTIAL(2)` | 评论审核是安全底线，ESENTIAL 级别仍可用 |
| `generateAutoReply` | `FULL(3)` | 自动回复是体验增强，可降级 |
| `translateText` | `FULL(3)` | 翻译也是体验增强 |
| `translateMarkdown` | `FULL(3)` | 同上 |

### 5.3 指数退避重试

[`generateTextWithRetry`](apps/api/src/common/ai/ai.service.ts:314) 提供带指数退避的重试能力：

```typescript
async generateTextWithRetry(
  prompt: string,
  options?: AiGenerationOptions,
  requiredLevel: AiServiceLevel = AiServiceLevel.FULL,
  maxRetries: number = 2,
): Promise<string | null> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await this.generateText(prompt, options, requiredLevel);
    if (result !== null) return result;

    // 服务可用但被限流 → 指数退避后重试
    if (this.isAvailable() && attempt < maxRetries) {
      const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    return null;
  }
  return null;
}
```

两种重试场景：
- **返回 null 但服务可用**：可能是瞬时限流，等待 1s→2s→4s 后重试
- **429 错误**：等待更长时间 2s→4s→8s 后重试

## 6. 业务场景实现

### 6.1 评论审核：`moderateComment`

评论审核是安全核心功能，[`moderateComment`](apps/api/src/common/ai/ai.service.ts:369) 使用 `ESSENTIAL` 级别确保在资源紧张时仍能运行。

```typescript
async moderateComment(
  content: string,
  articleTitle?: string,
): Promise<AiModerationResult> {
  const prompt = `...`; // 专业审核 prompt

  const response = await this.generateText(
    prompt,
    {
      temperature: 0,
      maxOutputTokens: 512,
      responseMimeType: 'application/json',
    },
    AiServiceLevel.ESSENTIAL, // 核心功能，ESSENTIAL 级别
  );

  if (!response) {
    // 降级策略：默认通过
    return { score: 0, passed: true, reason: null, categories: [] };
  }

  // 解析 JSON 响应，防御性编程
  const parsed = JSON.parse(this.extractJsonObject(response));
  return {
    score: typeof parsed.score === 'number' ? parsed.score : 0,
    passed: parsed.passed !== false,
    // ...
  };
}
```

**降级策略**：如果 AI 服务不可用（返回 null），默认 **放行** 评论（`passed: true`），避免误杀正常用户。这体现了"默认安全"的设计哲学——宁可漏过不良内容，也不误伤正常用户。

### 6.2 自动回复：`generateAutoReply`

[`generateAutoReply`](apps/api/src/common/ai/ai.service.ts:440) 使用 `FULL` 级别，温度设为 0.7 以生成更自然的回复：

```typescript
async generateAutoReply(
  comment: string,
  articleTitle: string,
  articleContent?: string,
): Promise<string | null> {
  // 服务等级预检
  if (this.serviceLevel < AiServiceLevel.FULL) {
    return null;
  }

  return this.generateText(
    prompt,
    { temperature: 0.7, maxOutputTokens: 256 },
    AiServiceLevel.FULL,
  );
}
```

### 6.3 多语言翻译：`translateText` / `translateMarkdown`

翻译功能使用 `FULL` 级别，温度设为 0.1 以保证翻译一致性。核心特点是**技术术语保留规则**：

```typescript
TECHNICAL TERMS MUST REMAIN IN ENGLISH:
- Framework names: NestJS, Next.js, React, Vue, Angular
- Database names: PostgreSQL, Redis, MongoDB, MySQL, Prisma
- Programming languages: TypeScript, JavaScript, Python, Java, Go
- Cloud services: Cloudflare, AWS, Google Cloud, Vercel
- Tools & libraries: Docker, Kubernetes, Tailwind CSS, Shadcn UI
- Security terms: XSS, CSRF, SQL Injection, JWT, OAuth, CORS
- AI terms: LLM, Prompt Engineering, AI Moderation, Machine Learning
- Abbreviations: API, HTML, CSS, REST, GraphQL, WebSocket, CLI

CRITICAL: Every Chinese word/phrase MUST be translated.
NO Chinese characters allowed in the output.
```

例如：
- `"XSS攻击"`（中文）→ `"XSS攻撃"`（日文）
- `"API设计"`（中文）→ `"APIデザイン"`（日文）
- `"敏感词过滤"`（中文）→ `"Sensitive Word Filtering"`（英文）

## 7. 监控与可观测性

### 7.1 `getUsageStats` 接口

[`getUsageStats`](apps/api/src/common/ai/ai.service.ts:637) 提供实时的服务状态快照：

```typescript
getUsageStats() {
  return {
    requests: this.usageCounter.requests,
    tokens: this.usageCounter.tokens,
    resetIn: Math.max(0, this.usageCounter.resetAt - Date.now()),
    serviceLevel: AiServiceLevel[this.serviceLevel],
    circuitBreakerOpen: this.circuitBreaker.openUntil > Date.now(),
    consecutiveFailures: this.circuitBreaker.consecutiveFailures,
  };
}
```

可以通过 API 暴露给监控面板，实时查看：
- 当前请求/Token 消耗
- 距离下一次配额重置的时间
- 当前服务等级
- 熔断器状态
- 连续失败次数

### 7.2 日志关键事件

```
🔄 AI service level recovered to: ESSENTIAL    # 自动恢复
⚠️  RPM limit reached, downgraded to ESSENTIAL  # RPM 超限降级
⚠️  TPM limit reached, downgraded to MINIMAL    # TPM 超限降级
⚠️  Vertex AI API 429 Resource Exhausted        # 配额耗尽
🔥 Circuit breaker OPENED for 15 minutes        # 熔断开启
AI circuit breaker closed, service restored      # 熔断关闭
```

## 8. 架构总结

```
                     ┌───────────────────────┐
                     │    generateText()      │
                     │   （统一入口，652行）    │
                     └───┬───────┬───────┬───┘
                         │       │       │
                    ┌────┘  ┌────┘  ┌───┘
                    ▼       ▼       ▼
            ┌──────────┐ ┌──────┐ ┌────────┐
            │ moderate │ │ auto │ │transl. │
            │ Comment  │ │Reply │ │ateText │
            │ESSENTIAL │ │ FULL │ │  FULL  │
            └────┬─────┘ └──────┘ └────────┘
                 │
                 ▼
            ┌─────────────────────────────────────┐
            │         AI 服务核心层                │
            │                                     │
            │  ┌─────────────────────────────┐    │
            │  │   服务等级管理 (4级阶梯)     │    │
            │  │  FULL→ESSENTIAL→MINIMAL→DIS │    │
            │  └─────────────────────────────┘    │
            │  ┌─────────────────────────────┐    │
            │  │   熔断器 (Circuit Breaker)   │    │
            │  │  5次失败→15min / 429→5min   │    │
            │  └─────────────────────────────┘    │
            │  ┌─────────────────────────────┐    │
            │  │   三重配额控制               │    │
            │  │  RPM(12) TPM(800k) Daily    │    │
            │  └─────────────────────────────┘    │
            │  ┌─────────────────────────────┐    │
            │  │   自动恢复定时器 (1s周期)    │    │
            │  │  60s重置 + 5min等级恢复     │    │
            │  └─────────────────────────────┘    │
            └─────────────────────────────────────┘
                         │
                         ▼
            ┌─────────────────────────────────────┐
            │         Gemini 2.5 Flash API        │
            │    Vertex AI (us-central1)           │
            │    Safety Settings: BLOCK_NONE       │
            └─────────────────────────────────────┘
```

### 核心设计原则

1. **优雅降级优于直接拒绝**——服务不可用时返回降级结果（如审核默认通过），而非抛异常
2. **防御性编程**——对 Gemini 的 JSON 响应进行类型校验，防止 API 返回格式异常导致崩溃
3. **自动恢复**——熔断和降级都是自动的，无需人工运维介入
4. **预留缓冲**——所有配额预留 20% 缓冲空间，避免硬撞官方限制

---

*本文源码基于 [`apps/api/src/common/ai/ai.service.ts`](apps/api/src/common/ai/ai.service.ts)（654行），完整包含 AiServiceLevel 枚举、三重配额控制、熔断器、指数退避重试、评论审核、自动回复、多语言翻译等全部实现。*
