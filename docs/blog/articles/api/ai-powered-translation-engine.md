---
title: 'AI 驱动翻译引擎：Google AI Studio Gemini 多层弹性架构'
slug: ai-powered-translation-engine
description: JoyMini API 的 AI 翻译引擎基于 Google AI Studio Gemini 构建，涵盖速率限制、服务级别降级、断路器、指数退避重试和 429 特殊处理等多层弹性模式，支撑批量翻译、评论审核和自动回复场景。
tags:
  - NestJS
  - Google AI Studio
  - Gemini
  - LLM
  - Translation
  - Content Moderation
  - Circuit Breaker
  - Rate Limiting
  - TypeScript
---

# AI 驱动翻译引擎：Google AI Studio Gemini 多层弹性架构

**日期：** 2026-05-01（更新：2026-05-02）
**标签：** `NestJS` `Google AI Studio` `Gemini` `LLM` `Translation` `Content Moderation` `Circuit Breaker` `Rate Limiting` `TypeScript`
**代码参考：** [`ai.service.ts`](apps/api/src/common/ai/ai.service.ts) | [`blog-ai.processor.ts`](apps/api/src/blog/processors/blog-ai.processor.ts) | [`recaptcha.service.ts`](apps/api/src/common/recaptcha/recaptcha.service.ts)

> **⚠️ 迁移通知（2026-05-02）：** 该服务已从 **Vertex AI（按量付费）** 迁移到 **Google AI Studio（免费层）**。关于成本控制、多密钥轮换和完整的迁移故事，请参阅[迁移文章](ai-service-migration-vertex-ai-to-ai-studio.md)。

---

## 目录

1. [架构概览](#1-架构概览)
2. [AI 服务层 — Vertex AI Gemini](#2-ai-服务层--vertex-ai-gemini)
3. [弹性模式](#3-弹性模式)
4. [翻译管道](#4-翻译管道)
5. [内容审核与自动回复](#5-内容审核与自动回复)
6. [与 BullMQ 集成](#6-与-bullmq-集成)
7. [对比：API AI 与 Admin-Blog AI 客户端](#7-对比api-ai-与-admin-blog-ai-客户端)
8. [关键要点](#8-关键要点)

---

## 1. 架构概览

AI 子系统采用**两层架构**，清晰分离关注点：

```
┌─────────────────────────────────────────────────────┐
│                 BlogAiProcessor                      │
│           (BullMQ Worker — 任务编排)                   │
│                                                      │
│   translate-article    moderate-comment              │
│   translate-category   auto-reply                    │
│   translate-tag                                      │
└──────────────────────┬──────────────────────────────┘
                        │ 调用
                        ▼
┌─────────────────────────────────────────────────────┐
│                   AiService                          │
│        (Vertex AI Gemini — LLM 集成)                 │
│                                                      │
│   ┌─────────────┐   ┌───────────┐   ┌──────────┐   │
│   │ 速率限制器    │   │ 断路器     │   │ 服务级别   │   │
│   │ (12 RPM)    │   │ (5次失败)  │──▶│ (降级)    │   │
│   │ (800K TPM)  │──▶│           │   │          │   │
│   └─────────────┘   └───────────┘   └──────────┘   │
└─────────────────────────────────────────────────────┘
```

- **`AiService`** — 通用 LLM 集成层。处理 API 通信、速率限制、断路和服务级别降级。**不关心**文章、评论或业务逻辑。
- **`BlogAiProcessor`** — 业务逻辑编排器。定义 5 种任务类型，通过 `TranslationJobService` 管理翻译进度，解析 AI 响应，并将结果写回数据库。

这种分离意味着 `AiService` 可以用于任何 AI 功能——聊天审核、摘要生成、语义搜索——而无需修改。

---

## 2. AI 服务层 — Vertex AI Gemini

### 2.1 初始化

该服务使用 **Google Vertex AI** 和 `gemini-2.5-flash` 模型，这是一个符合免费层条件的模型，具有慷慨的配额：

```typescript
// ai.service.ts（第 121-181 行）
private initializeVertexAI() {
  const googleCredsRaw = this.configService.get<string>('GOOGLE_VISION_CREDENTIALS');
  if (!googleCredsRaw) return;  // 优雅禁用

  const credentials = JSON.parse(googleCredsRaw);
  this.vertexAI = new VertexAI({
    project: credentials.project_id,
    location: 'us-central1',
    googleAuthOptions: { credentials },
  });

  this.geminiModel = this.vertexAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    safetySettings: [
      { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
      // ... 所有安全类别设置为 BLOCK_NONE（我们自行处理审核）
    ],
    generationConfig: { temperature: 0, maxOutputTokens: 2048 },
  });
}
```

关键设计决策：
- **禁用所有安全过滤器** — 应用自身的审核（`moderateComment()`）使用更细致、领域特定的逻辑处理内容过滤
- **翻译任务使用温度 0** — 最大确定性和一致性
- **优雅降级** — 缺少凭证时仅禁用服务，不会崩溃

### 2.2 统一文本生成接口

所有 AI 操作都通过单一的 `generateText()` 方法进行，该方法强制执行配额和服务级别：

```typescript
async generateText(
  prompt: string,
  options?: AiGenerationOptions,
  requiredLevel: AiServiceLevel = AiServiceLevel.FULL,
): Promise<string | null> {
  if (!this.isEnabled || this.serviceLevel < requiredLevel) return null;
  if (!this.checkRateLimit(estimatedTokens)) return null;

  try {
    const result = await this.geminiModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: options,
    });
    // ... 解析并返回
  } catch (e) {
    this.recordFailure();
    // 特殊处理 429
  }
}
```

`requiredLevel` 参数非常巧妙——它允许调用者指定他们需要的服务级别：
- `FULL` — 翻译、自动回复（系统繁忙时可跳过）
- `ESSENTIAL` — 评论审核（安全相关，即使负载下也运行）
- `MINIMAL` — 保留供将来使用
- `DISABLED` — 没有可用的 AI 功能

---

## 3. 弹性模式

AI 服务实现了**四个互补的弹性层**，防止 Google API 配额耗尽、瞬时故障和持续中断。

### 3.1 速率限制

```typescript
private readonly LIMITS = {
  RPM: 12,      // 官方 15 - 20% 缓冲
  TPM: 800000,  // 官方 1M - 20% 缓冲
  FAILURE_THRESHOLD: 5,
  CIRCUIT_BREAKER_DURATION: 900000,  // 15 分钟
};
```

- **每分钟请求数**（12 RPM）— 防止突发请求耗尽配额
- **每分钟令牌数**（800K TPM）— 根据提示长度 + maxOutputTokens 估算
- **1 秒周期重置** — 计数器每分钟重置以确保准确性

### 3.2 服务级别降级

当达到限制时，系统会**优雅降级**而不是硬失败：

| 级别 | 值 | 能力 | 触发条件 |
|-------|-------|-------------|---------|
| `FULL` | 3 | 全部功能 | 默认状态 |
| `ESSENTIAL` | 2 | 仅审核 | RPM 超出 |
| `MINIMAL` | 1 | 仅缓存结果 | TPM 超出 |
| `DISABLED` | 0 | 无功能 | 断路器打开 |

```typescript
private checkRateLimit(estimatedTokens: number): boolean {
  if (this.usageCounter.requests >= this.LIMITS.RPM) {
    if (this.serviceLevel > AiServiceLevel.ESSENTIAL) {
      this.serviceLevel = AiServiceLevel.ESSENTIAL;
      this.logger.warn(`达到 RPM 限制，降级为 ESSENTIAL 模式`);
    }
    return false;
  }
  // ... TPM 类似逻辑 → MINIMAL
}
```

### 3.3 断路器

在**连续 5 次失败**后，断路器打开**15 分钟**：

```typescript
if (this.circuitBreaker.consecutiveFailures >= this.LIMITS.FAILURE_THRESHOLD) {
  this.circuitBreaker.openUntil = Date.now() + this.LIMITS.CIRCUIT_BREAKER_DURATION;
  this.serviceLevel = AiServiceLevel.DISABLED;
}
```

周期性的 `resetCounters()` 方法（每 1 秒运行一次）会自动关闭断路器并逐渐恢复服务级别（每 5 分钟恢复一级）。

### 3.4 指数退避重试

`generateTextWithRetry()` 包装器添加了智能重试逻辑：

```typescript
async generateTextWithRetry(prompt: string, options?, requiredLevel?, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await this.generateText(prompt, options, requiredLevel);
    if (result !== null) return result;
    if (this.isAvailable() && attempt < maxRetries) {
      const delay = Math.pow(2, attempt) * 1000;  // 1s、2s、4s
      await new Promise(r => setTimeout(r, delay));
    }
  }
}
```

### 3.5 429 特殊处理

当 Vertex AI 返回 `RESOURCE_EXHAUSTED`（429）时：

```typescript
if (e.code === 429 || e.status === 'RESOURCE_EXHAUSTED') {
  this.serviceLevel = AiServiceLevel.MINIMAL;     // 立即降级
  this.circuitBreaker.openUntil = Date.now() + 300000;  // 5 分钟快速断路
}
```

这比标准断路器更激进（5 分钟 vs 15 分钟）——假设 429 通常是会快速解决的临时资源争用。

---

## 4. 翻译管道

### 4.1 批量翻译策略

`BlogAiProcessor` 实现了一种复杂的批量翻译方法，在**单次 API 调用**中翻译**标题、内容和摘要**：

```typescript
// blog-ai.processor.ts（第 213-446 行）
private async batchTranslateArticle(
  article: any, targetLang: string, isUpdate: boolean
): Promise<TranslationResult> {
  const getSourceContent = (field: string, localizedField: string) => {
    return field === sourceLang
      ? article[localizedField]
      : article[localizedField]?.[sourceLang] || article[localizedField];
  };

  const prompt = `
    将以下博客文章翻译为 ${targetLangName}。
    返回包含翻译后的标题、内容和摘要的 JSON 对象。

    关键：以下是技术术语，必须保持英文：
    NestJS, Next.js, React, TypeScript, PostgreSQL, Redis, Prisma, Docker, ...

    源文本：
    标题：${getSourceContent(...)}
    内容：${getSourceContent(...)}
    摘要：${getSourceContent(...)}
  `;

  const response = await this.translateWithRetry(prompt);
  // 解析 JSON 响应 → 如果解析失败，回退到传统翻译
}
```

**关键功能：**
- **三个字段一次往返** — 最小化 API 调用和令牌使用
- **技术术语保护** — 框架名称、云服务、协议和缩写的广泛白名单，必须保持英文
- **JSON 模式** — `responseMimeType: 'application/json'` 用于结构化输出
- **JSON 修复** — 如果 Gemini 返回格式错误的 JSON，在回退前尝试修复

### 4.2 翻译回退链

系统实现了**三层回退**以确保稳健性：

```
1. Gemini JSON 响应 → 解析结构化结果
        ↓ 失败
2. JSON 修复 → 尝试括号匹配、截断修复
        ↓ 失败
3. 传统翻译 → 回退到纯文本翻译
```

### 4.3 进度跟踪

翻译任务使用 `TranslationJobService` 进行实时进度跟踪：

```typescript
// blog-ai.processor.ts（第 707-949 行）
private async processArticleTranslation(job: Job) {
  const { articleId, targetLang } = job.data;

  // 更新状态：pending → processing → completed/failed
  await this.translationJobService.updateJobStatus(jobId, 'processing');

  const result = await this.batchTranslateArticle(article, targetLang, isUpdate);

  // 将本地化字段写入数据库
  await this.prismaService.articleLocale.upsert({
    where: { articleId_language: { articleId, language: targetLang } },
    update: {
      title: result.title,
      content: result.content,
      excerpt: result.excerpt,
    },
    create: { articleId, language: targetLang, ... },
  });

  await this.translationJobService.updateJobStatus(jobId, 'completed');
}
```

### 4.4 翻译缓存

为避免重复翻译相同内容，使用**带 TTL 的内存缓存**：

```typescript
private readonly translationCache = new Map<string, { result: any; timestamp: number }>();
private readonly CACHE_TTL = 3600000;  // 1 小时
private readonly CACHE_CLEANUP_INTERVAL = 300000;  // 5 分钟
```

缓存键是 `sourceLang + targetLang + contentHash` 的哈希值，周期性的清理间隔防止内存泄漏。

---

## 5. 内容审核与自动回复

### 5.1 评论 AI 审核

`moderateComment()` 方法在 `ESSENTIAL` 服务级别运行（在降级期间仍存活）：

```typescript
async moderateComment(content: string, articleTitle?: string): Promise<AiModerationResult> {
  const prompt = `
    作为专业内容审核员。分析此评论...
    评分从 0-100。0=安全，100=危险。
    passed = score < 50
    如果 score < 30，以评论的相同语言提供 autoReplySuggestion
    返回 JSON：{ score, passed, reason, categories, autoReplySuggestion }
  `;

  const response = await this.generateText(prompt, { responseMimeType: 'application/json' },
    AiServiceLevel.ESSENTIAL);

  if (!response) return { score: 0, passed: true, reason: null, categories: [] };

  // 防御性解析 — 确保契约合规
  return {
    score: typeof parsed.score === 'number' ? parsed.score : 0,
    passed: parsed.passed !== false,    // 默认：批准
    categories: Array.isArray(parsed.categories) ? parsed.categories : [],
    autoReplySuggestion: typeof parsed.autoReplySuggestion === 'string' ? ... : null,
  };
}
```

`BlogAiProcessor` 随后根据评分决定：
- **评分 < 30** → 自动批准 + 安排自动回复（30 秒模拟延迟）
- **评分 < 50** → 需要人工审核
- **评分 ≥ 50** → 自动拒绝

### 5.2 自动回复生成

自动回复在 `FULL` 服务级别生成，具有创意温度（0.7）：

```typescript
async generateAutoReply(comment: string, articleTitle: string, articleContent?: string) {
  if (this.serviceLevel < AiServiceLevel.FULL) return null;

  const prompt = `
    作为友好的博客社区管理员。生成自然的回复...
    规则：1-2 句话，像人一样，引用评论内容，
    不要提及自己是 AI，使用与评论相同的语言
  `;

  return this.generateText(prompt, { temperature: 0.7, maxOutputTokens: 256 },
    AiServiceLevel.FULL);
}
```

发布自动回复前的 30 秒模拟延迟创造了**更自然的节奏**——用户不会看到即时的机器人回复。

### 5.3 集成 reCAPTCHA

[`RecaptchaService`](apps/api/src/common/recaptcha/recaptcha.service.ts) 为面向公众的表单增加了另一层安全：

```typescript
// recaptcha.service.ts
async verifyToken(token: string, expectedAction?: string): Promise<RecaptchaResult> {
  try {
    const response = await axios.post('https://www.google.com/recaptcha/api/siteverify', null, {
      params: { secret: this.configService.get('RECAPTCHA_SECRET_KEY'), response: token }
    });
    const { success, score, action } = response.data;

    if (!success) return { passed: false, reason: '验证失败' };
    if (expectedAction && action !== expectedAction) return { passed: false, reason: '操作不匹配' };
    if (score < this.threshold) return { passed: false, reason: `评分过低：${score}` };

    return { passed: true, score };
  } catch {
    // 下游降级 — Google 失败时允许通过
    return { passed: true, score: 0.5 };
  }
}
```

**下游降级** —— 如果 Google 的 reCAPTCHA API 无法访问，服务会以中性评分允许请求通过，而不是阻止合法用户。

---

## 6. 与 BullMQ 集成

### 6.1 任务类型

`BlogAiProcessor` 通过 BullMQ 队列处理 5 种任务类型：

```typescript
async process(job: Job): Promise<any> {
  switch (job.name) {
    case 'translate-article':     return this.processArticleTranslation(job);
    case 'translate-category':    return this.processCategoryTranslation(job);
    case 'translate-tag':         return this.processTagTranslation(job);
    case 'moderate-comment':      return this.processCommentModeration(job);
    case 'auto-reply':            return this.processAutoReply(job.data);
  }
}
```

### 6.2 配置

```typescript
@Processor('blog-ai', {
  concurrency: 1,  // 单并发任务 — 尊重 AI 速率限制
  limiter: {
    max: 5,        // 每分钟 5 个任务
    duration: 60000,
  },
})
```

**并发数 1** + **限制器 5 RPM** 创建了背压机制——如果队列填满，任务会自然等待，防止 API 配额耗尽。

### 6.3 翻译任务流程

```
管理员点击"翻译文章"
       │
       ▼
BlogAiController → 入队任务（translate-article）
       │
       ▼
BlogAiProcessor.process()
       │
       ▼
processArticleTranslation()
       │
       ├──→ 检查缓存（translationCache）
       ├──→ batchTranslateArticle() → Gemini API
       ├──→ 解析 JSON 响应
       ├──→ 更新 TranslationJobService 进度
       ├──→ 将 articleLocale 写入数据库
       └──→ 标记任务完成
```

---

## 7. 对比：API AI 与 Admin-Blog AI 客户端

| 特性 | API `AiService` + `BlogAiProcessor` | Admin-Blog `api/index.ts` AI 端点 |
|---------|--------------------------------------|----------------------------------------|
| **LLM** | Vertex AI Gemini 2.5 Flash | 无直接 LLM — 通过 API 代理 |
| **队列** | BullMQ 后台处理 | 直接 HTTP 请求/响应 |
| **弹性** | 断路器、速率限制、服务级别 | 客户端超时 + 重试 |
| **缓存** | 带 1h TTL 的内存 Map + 清理 | 无 |
| **翻译** | 批量（每次调用 3 个字段） | 单文章触发 |
| **审核** | AI 驱动，带自动回复 | 评论 CRUD + 状态更新 |
| **进度** | TranslationJobService 跟踪 | 轮询 `/translation-progress` |
| **回退** | JSON 修复 → 传统翻译 | 不适用 |

Admin-blog 客户端向 API 的翻译端点发送 HTTP 请求，然后委托给 `BlogAiProcessor` 队列。这意味着 admin-blog **从不直接调用 Gemini** —— 一切都通过 API 的弹性层流动。

---

## 8. 关键要点

1. **两层分离** —— `AiService` 处理 LLM 通信和弹性；`BlogAiProcessor` 处理业务逻辑。每层可以独立演进。

2. **四层弹性** —— 速率限制（RPM/TPM 配额）→ 服务级别降级（FULL→ESSENTIAL→MINIMAL→DISABLED）→ 断路器（5 次失败 = 15 分钟打开）→ 指数退避重试。每层捕获不同的故障模式。

3. **成本意识设计** —— 官方配额以下 20% 缓冲、单次往返批量翻译、带清理的内存缓存、缺少凭证时优雅禁用。

4. **处处优雅降级** —— 缺少凭证 → 服务关闭。Google API 宕机 → reCAPTCHA 允许通过。JSON 解析失败 → 返回安全默认值。LLM 返回 null → 原样返回原文。

5. **自然感的自动化** —— 自动回复前 30 秒模拟延迟、回复使用创意温度（0.7）vs 翻译使用确定性温度（0.0）、语言匹配的响应。

6. **类型安全的弹性** —— `AiServiceLevel` 枚举带 `requiredLevel` 参数，让调用者声明其关键性。评论审核在 `ESSENTIAL` 级别运行（降级期间存活），而自动回复需要 `FULL` 级别。
