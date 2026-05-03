---
title: 'AI 多 Provider 抽象层：Gemini + Groq + DeepSeek 统一接入与自动故障转移'
slug: ai-service-multi-provider-abstraction-layer
description: JoyMini API 的 AI 服务从 Gemini 单 Provider 演进为多 Provider 抽象架构，支持 Gemini、Groq、DeepSeek 三大 AI 提供商统一接入、自动故障转移、Provider 级密钥轮换和 Admin UI 可视化配置。
tags:
  - NestJS
  - Gemini
  - Groq
  - DeepSeek
  - LLM
  - AI
  - Provider Abstraction
  - Circuit Breaker
  - Rate Limiting
  - TypeScript
---

# AI 多 Provider 抽象层：Gemini + Groq + DeepSeek 统一接入与自动故障转移

**日期：** 2026-05-03
**标签：** `NestJS` `Gemini` `Groq` `DeepSeek` `LLM` `AI` `Provider Abstraction` `Circuit Breaker` `Rate Limiting` `TypeScript`
**代码参考：** [`ai-provider.interface.ts`](apps/api/src/common/ai/interfaces/ai-provider.interface.ts) | [`ai.service.ts`](apps/api/src/common/ai/ai.service.ts) | [`gemini.provider.ts`](apps/api/src/common/ai/providers/gemini.provider.ts) | [`groq.provider.ts`](apps/api/src/common/ai/providers/groq.provider.ts) | [`deepseek.provider.ts`](apps/api/src/common/ai/providers/deepseek.provider.ts) | [`blog.controller.ts`](apps/api/src/blog/blog.controller.ts)

> **前置阅读：** 本文是 AI 服务系列的第三篇。建议先阅读 [AI 驱动翻译引擎](ai-powered-translation-engine.md) 了解 Gemini 单 Provider 架构，以及 [AI 服务迁移](ai-service-migration-vertex-ai-to-ai-studio.md) 了解从 Vertex AI 到 AI Studio 的迁移背景。

---

## 目录

1. [问题：Gemini 免费配额瓶颈](#1-问题gemini-免费配额瓶颈)
2. [架构设计：Provider 抽象层](#2-架构设计provider-抽象层)
3. [Provider 接口定义](#3-provider-接口定义)
4. [Provider 实现对比](#4-provider-实现对比)
5. [Provider 选择与故障转移流程](#5-provider-选择与故障转移流程)
6. [共享基础设施](#6-共享基础设施)
7. [Admin UI 配置](#7-admin-ui-配置)
8. [如何添加新的 Provider](#8-如何添加新的-provider)
9. [Provider 能力矩阵](#9-provider-能力矩阵)
10. [总结](#10-总结)

---

## 1. 问题：Gemini 免费配额瓶颈

在迁移到 Google AI Studio 免费层后，AI 服务面临新的瓶颈：

| 限制项 | 值 | 影响 |
|--------|-----|------|
| Gemini 2.5 Flash 每日请求 | 20 次/天/项目 | 4 个 API Key 共享项目级配额 |
| 配额耗尽后 | 服务完全不可用 | 翻译、评论审核、自动回复全部停止 |
| 恢复时间 | 等待 UTC 午夜重置 | 最长可能停机 24 小时 |

**核心矛盾：** Gemini 2.5 Flash 虽然是免费的，但 20 次/天的请求配额对于需要批量翻译文章、审核评论、生成自动回复的博客系统来说远远不够。一旦配额耗尽，整个 AI 子系统就会瘫痪，直到第二天 UTC 零点。

**解决方案：** 引入多 Provider 抽象层，将 AI 服务从 Gemini 单点依赖重构为 Provider 无关的编排层。当主 Provider 不可用时，自动切换到备用 Provider，实现无缝故障转移。

---

## 2. 架构设计：Provider 抽象层

### 2.1 演进对比

**之前（Gemini 单 Provider）：**

```
AiService
  ├── keyInstances: GeminiKeyInstance[]  (GoogleGenerativeAI SDK)
  ├── generateText() → 直接调用 Gemini SDK
  ├── generateContentFromImage() → Gemini Vision
  └── 所有功能耦合在一起
```

**之后（多 Provider 抽象层）：**

```
AiService (编排层)
  ├── 共享基础设施（所有 Provider 共用）:
  │   ├── 断路器 (5次连续失败 → 15分钟断开)
  │   ├── 速率限制器 (RPM/TPM 每分钟)
  │   ├── 服务等级降级 (FULL→ESSENTIAL→MINIMAL→DISABLED)
  │   └── 每日计数器重置 (UTC 00:00)
  │
  ├── providers: AiProviderInstance[]
  │   ├── [0] GeminiProvider
  │   │   ├── 密钥轮换 (4个 Key)
  │   │   ├── generateText() → Google AI Studio SDK
  │   │   └── generateContentFromImage() → Vision (Gemini 独占)
  │   │
  │   ├── [1] GroqProvider
  │   │   ├── 密钥轮换 (多个 Key)
  │   │   ├── generateText() → OpenAI 兼容 API
  │   │   └── 模型: Llama 3.3 / Mixtral
  │   │
  │   └── [2] DeepSeekProvider
  │       ├── 密钥轮换 (多个 Key)
  │       ├── generateText() → OpenAI 兼容 API
  │       └── 模型: deepseek-chat / deepseek-reasoner
  │
  └── Provider 选择 (从 SystemConfig 读取):
      1. 读取 AI_TRANSLATION_PROVIDER 配置
      2. 主 Provider 失败 → 自动切换到下一个可用 Provider
      3. 所有 Provider 失败 → 记录失败，返回 null
```

### 2.2 核心设计原则

1. **向后兼容** — 现有的 `GOOGLE_GEMINI_API_KEY` 环境变量无需任何改动
2. **Provider 无关** — `AiService` 不直接依赖任何 Provider 的 SDK，只通过接口交互
3. **优雅降级** — 主 Provider 失败 → 自动 fallback → 所有 Provider 失败 → 断路器保护
4. **可扩展** — 新增 Provider 只需实现 `AiProviderInstance` 接口，无需修改编排逻辑

---

## 3. Provider 接口定义

核心接口定义在 [`ai-provider.interface.ts`](apps/api/src/common/ai/interfaces/ai-provider.interface.ts)：

### AiProviderInstance

```typescript
export interface AiProviderInstance {
  readonly name: string;          // 'gemini' | 'groq' | 'deepseek'
  readonly displayName: string;   // 'Google Gemini' | 'Groq' | 'DeepSeek'
  readonly models: string[];      // 可用模型列表
  activeModel: string;            // 当前选中的模型

  keys: AiKeyInstance[];          // API Key 列表（支持多 Key 轮换）
  activeKeyIndex: number;         // 当前活跃 Key 的索引

  generateText(prompt: string, options?: AiGenerationOptions): Promise<string | null>;
  isAvailable(): boolean;
  getUsageStats(): AiProviderUsageStats;
  rotateToNextKey(): boolean;
  resetDailyCounters(): void;
}
```

### AiKeyInstance

```typescript
export interface AiKeyInstance {
  keySuffix: string;       // Key 的后 4 位（用于显示，不暴露完整 Key）
  dailyTokens: number;     // 今日已用 Token 数
  dailyRequests: number;   // 今日已用请求数
  blocked: boolean;        // 是否被暂时封禁（429 后冷却）
  blockedReason: string | null;
  blockedUntil: number;    // 封禁到期时间戳
}
```

### AiProviderUsageStats

```typescript
export interface AiProviderUsageStats {
  name: string;
  displayName: string;
  activeModel: string;
  activeKeyIndex: number;
  keys: {
    index: number;
    keySuffix: string;
    dailyTokens: number;
    dailyRequests: number;
    dailyLimit: number;
    blocked: boolean;
    blockedReason: string | null;
    isActive: boolean;
  }[];
}
```

---

## 4. Provider 实现对比

### 4.1 GeminiProvider

[`gemini.provider.ts`](apps/api/src/common/ai/providers/gemini.provider.ts)（306 行）

- **SDK：** `@google/generative-ai`（Google 官方 SDK）
- **模型：** `gemini-2.5-flash`（唯一免费模型）
- **每日限额：** 800,000 tokens/天/Key
- **API Key：** 从 `GOOGLE_GEMINI_API_KEY` 环境变量读取，逗号分隔支持多 Key
- **独占能力：** `generateContentFromImage()` — 图片内容识别（KYC OCR 使用）
- **初始化：**

```typescript
@Injectable()
export class GeminiProvider implements AiProviderInstance {
  readonly name = 'gemini';
  readonly displayName = 'Google Gemini';
  readonly models = ['gemini-2.5-flash'];
  activeModel = 'gemini-2.5-flash';

  constructor(private configService: ConfigService) {
    this.initialize();
  }

  private initialize() {
    const apiKeyRaw = this.configService.get<string>('GOOGLE_GEMINI_API_KEY');
    // 解析逗号分隔的 Key，创建 GoogleGenerativeAI 实例
  }
}
```

### 4.2 GroqProvider

[`groq.provider.ts`](apps/api/src/common/ai/providers/groq.provider.ts)（245 行）

- **API：** OpenAI 兼容 API（`https://api.groq.com/openai/v1/chat/completions`）
- **模型：** `llama-3.3-70b-versatile`（默认）、`llama3-70b-8192`、`llama-3.1-8b-instant`
- **每日限额：** 500,000 tokens/天/Key
- **API Key：** 从 `GROQ_API_KEY` 环境变量读取
- **特点：** 使用 axios 发送 HTTP 请求，无需额外 SDK

```typescript
@Injectable()
export class GroqProvider implements AiProviderInstance {
  readonly name = 'groq';
  readonly displayName = 'Groq';
  readonly models = ['llama-3.3-70b-versatile', 'llama3-70b-8192', 'llama-3.1-8b-instant'];
  activeModel = 'llama-3.3-70b-versatile';

  async generateText(prompt: string, options?: AiGenerationOptions): Promise<string | null> {
    // 1. 检查 Key 是否可用
    // 2. POST 到 Groq API
    // 3. 处理 429 → 封禁 Key 60 秒，轮换到下一个 Key
    // 4. 返回 response.data.choices[0].message.content
  }
}
```

### 4.3 DeepSeekProvider

[`deepseek.provider.ts`](apps/api/src/common/ai/providers/deepseek.provider.ts)（258 行）

- **API：** OpenAI 兼容 API（`https://api.deepseek.com/v1/chat/completions`）
- **模型：** `deepseek-chat`（DeepSeek-V3，默认）、`deepseek-reasoner`（DeepSeek-R1）
- **每日限额：** 10,000,000 tokens/天/Key（远高于 Groq 和 Gemini）
- **API Key：** 从 `DEEPSEEK_API_KEY` 环境变量读取
- **特点：** 免费注册赠送 500 万 Token（一次性），每日 1000 万 Token 限额

```typescript
@Injectable()
export class DeepSeekProvider implements AiProviderInstance {
  readonly name = 'deepseek';
  readonly displayName = 'DeepSeek';
  readonly models = ['deepseek-chat', 'deepseek-reasoner'];
  activeModel = 'deepseek-chat';

  async generateText(prompt: string, options?: AiGenerationOptions): Promise<string | null> {
    // 1. 检查 Key 是否可用
    // 2. POST 到 DeepSeek API
    // 3. 处理 429 → 封禁 Key 60 秒，轮换到下一个 Key
    // 4. 返回 response.data.choices[0].message.content
  }
}
```

---

## 5. Provider 选择与故障转移流程

[`ai.service.ts`](apps/api/src/common/ai/ai.service.ts) 中的 `generateText()` 方法是整个系统的核心编排逻辑：

```typescript
async generateText(
  prompt: string,
  options?: AiGenerationOptions,
  requiredLevel: AiServiceLevel = AiServiceLevel.FULL,
): Promise<string | null> {
  // 1. 检查共享前置条件
  if (!this.checkPreConditions(requiredLevel, estimatedTokens)) return null;

  // 2. 从 SystemConfig 读取 Provider 配置（带 30 秒缓存）
  const config = await this.getProviderConfig();
  const primaryProvider = this.providers.find(p => p.name === config.provider) || this.providers[0];
  const fallbackProviders = this.providers.filter(p => p.name !== config.provider);

  // 3. 设置主 Provider 的模型
  if (config.model && primaryProvider.models.includes(config.model)) {
    primaryProvider.activeModel = config.model;
  }

  // 4. 尝试主 Provider
  const result = await primaryProvider.generateText(prompt, options);
  if (result !== null) {
    this.recordSuccess(estimatedTokens);
    return result;
  }

  // 5. 按顺序尝试备用 Provider
  for (const fallback of fallbackProviders) {
    if (!fallback.isAvailable()) continue;
    const fallbackResult = await fallback.generateText(prompt, options);
    if (fallbackResult !== null) {
      this.recordSuccess(estimatedTokens);
      return fallbackResult;
    }
  }

  // 6. 所有 Provider 都失败
  this.recordFailure();
  return null;
}
```

### 流程图

```
generateText 被调用
    │
    ▼
检查共享前置条件
    │
    ├── 断路器打开? ──→ 返回 null
    ├── 速率限制? ──→ 返回 null
    ├── 服务等级不足? ──→ 返回 null
    └── 通过
         │
         ▼
    从 SystemConfig 读取 Provider 配置
    （30 秒内存缓存，避免每次请求都查数据库）
         │
         ▼
    确定主 Provider 和备用 Provider 列表
         │
         ▼
    ┌── 尝试主 Provider ──→ 成功? ──→ 返回结果
    │       │
    │      失败
    │       ▼
    │  尝试下一个备用 Provider ──→ 成功? ──→ 返回结果
    │       │
    │      失败
    │       ▼
    │  还有更多备用 Provider? ──→ 是 ──→ 继续尝试
    │       │
    │      否
    │       ▼
    └── 记录失败，返回 null
```

### 故障转移示例

| 场景 | 主 Provider | 行为 | 结果 |
|------|------------|------|------|
| Gemini 配额耗尽 | Gemini | 自动切换到 Groq | 翻译继续，用户无感知 |
| Groq 429 限流 | Groq | 封禁该 Key 60 秒，轮换到下一个 Key | 短暂延迟后恢复 |
| 所有 Provider 都失败 | 任意 | 断路器记录失败，5 次后断开 15 分钟 | 服务降级到 DISABLED |
| 午夜 UTC | 任意 | 所有 Provider 计数器重置 | 自动恢复 FULL 服务 |

---

## 6. 共享基础设施

所有 Provider 共享以下基础设施，定义在 [`ai.service.ts`](apps/api/src/common/ai/ai.service.ts)：

### 6.1 断路器

```typescript
private circuitBreaker = {
  consecutiveFailures: 0,    // 连续失败次数
  openUntil: 0,              // 断开到期时间
  lastFailureAt: 0,          // 上次失败时间
};
```

- **触发条件：** 5 次连续失败（非 429 错误）
- **断开时长：** 15 分钟
- **恢复：** 到期后自动关闭，计数器归零

### 6.2 速率限制器

```typescript
private readonly LIMITS = {
  RPM: 12,                    // 每分钟最多 12 次请求
  TPM: 800000,                // 每分钟最多 800k Token
  DAILY_PER_KEY: 800000,      // 每 Key 每天最多 800k Token
  FAILURE_THRESHOLD: 5,       // 断路器触发阈值
  CIRCUIT_BREAKER_DURATION: 900000,  // 断路器 15 分钟
  KEY_429_COOLDOWN: 60000,    // 429 冷却 60 秒
};
```

- **每分钟重置：** 请求数和 Token 数每分钟归零
- **跨 Provider 共享：** 所有 Provider 共用同一个速率计数器

### 6.3 服务等级降级

| 等级 | 值 | 允许的功能 | 触发条件 |
|------|-----|-----------|---------|
| FULL | 3 | 全部功能（翻译、审核、自动回复） | 正常状态 |
| ESSENTIAL | 2 | 仅评论审核 | RPM 超限 |
| MINIMAL | 1 | 仅基础功能 | TPM 超限 |
| DISABLED | 0 | 无 | 断路器断开 |

- **自动恢复：** 每 5 分钟检查一次，逐步恢复等级

### 6.4 每日计数器重置

- **触发：** UTC 00:00（检测日期变化）
- **操作：** 重置所有 Provider 的每日 Token/请求计数器
- **额外：** 如果服务等级是 DISABLED，同时恢复到 FULL

---

## 7. Admin UI 配置

### 7.1 API 端点

[`blog.controller.ts`](apps/api/src/blog/blog.controller.ts) 提供了三个 AI Provider 管理端点：

| 端点 | 方法 | 用途 |
|------|------|------|
| `/admin/blog/ai/providers` | GET | 获取可用 Provider 列表及模型 |
| `/admin/blog/ai/provider-config` | GET | 获取当前 Provider/模型配置 |
| `/admin/blog/ai/provider-config` | PATCH | 更新 Provider/模型配置 |

### 7.2 Provider 选择器

Admin UI 中的 Provider 选择器组件允许管理员：

1. **选择 Provider：** 从 Gemini / Groq / DeepSeek 下拉选择
2. **选择模型：** 根据所选 Provider 动态加载可用模型
3. **保存配置：** 持久化到 SystemConfig，实时生效

### 7.3 用量监控

AI 服务状态卡片展示每个 Provider 的独立用量：

```
┌─────────────────────────────────────┐
│ 🤖 AI 服务状态                       │
│                                      │
│ 服务等级: FULL                       │
│ 健康状态: ● 正常                     │
│                                      │
│ ─── Providers ───                    │
│                                      │
│ Gemini (当前使用)                     │
│  Key #1: ████████░░ 640k/800k       │
│  Key #2: ██░░░░░░░░ 120k/800k       │
│  今日请求: 12                         │
│                                      │
│ Groq                                  │
│  Key #1: ░░░░░░░░░░ 0k/500k         │
│  今日请求: 0                          │
│                                      │
│ DeepSeek                              │
│  Key #1: ░░░░░░░░░░ 0k/10,000k      │
│  今日请求: 0                          │
│                                      │
│ ─── 总用量 ───                       │
│  请求: 12 | Token: 760k              │
│  成功率: 100%                         │
│                                      │
│ 速率限制: RPM:12 | TPM:800k          │
└─────────────────────────────────────┘
```

---

## 8. 如何添加新的 Provider

多 Provider 抽象层的设计目标之一就是易于扩展。添加一个新的 AI Provider 只需 4 步：

### 步骤 1：创建 Provider 类

新建文件 `apps/api/src/common/ai/providers/xxx.provider.ts`，实现 `AiProviderInstance` 接口：

```typescript
@Injectable()
export class XxxProvider implements AiProviderInstance {
  readonly name = 'xxx';
  readonly displayName = 'XXX AI';
  readonly models = ['model-1', 'model-2'];
  activeModel = 'model-1';

  keys: AiKeyInstance[] = [];
  activeKeyIndex = 0;

  constructor(private configService: ConfigService) {
    this.initialize();
  }

  private initialize() {
    const apiKeyRaw = this.configService.get<string>('XXX_API_KEY');
    // 解析 Key，初始化状态
  }

  async generateText(prompt: string, options?: AiGenerationOptions): Promise<string | null> {
    // 实现文本生成逻辑
  }

  isAvailable(): boolean { /* ... */ }
  getUsageStats(): AiProviderUsageStats { /* ... */ }
  rotateToNextKey(): boolean { /* ... */ }
  resetDailyCounters(): void { /* ... */ }
}
```

### 步骤 2：注册到 Module

在 [`ai.module.ts`](apps/api/src/common/ai/ai.module.ts) 中添加 Provider：

```typescript
@Global()
@Module({
  providers: [AiService, GeminiProvider, GroqProvider, DeepSeekProvider, XxxProvider],
  exports: [AiService],
})
export class AiModule {}
```

### 步骤 3：注入到 AiService

在 [`ai.service.ts`](apps/api/src/common/ai/ai.service.ts) 的构造函数中注入，并在 `onModuleInit()` 中注册：

```typescript
constructor(
  private configService: ConfigService,
  private geminiProvider: GeminiProvider,
  private groqProvider: GroqProvider,
  private deepSeekProvider: DeepSeekProvider,
  private xxxProvider: XxxProvider,  // 新增
) {}

async onModuleInit() {
  this.providers = [
    this.geminiProvider,
    this.groqProvider,
    this.deepSeekProvider,
    this.xxxProvider,  // 新增
  ];
}
```

### 步骤 4：添加环境变量

在 `.env` 和 `.env.example` 中添加新的 API Key：

```bash
XXX_API_KEY=key1,key2,key3
```

---

## 9. Provider 能力矩阵

| 能力 | Gemini | Groq | DeepSeek |
|------|--------|------|----------|
| 文本生成（翻译） | ✅ | ✅ | ✅ |
| 图片识别（OCR） | ✅ | ❌ | ❌ |
| `responseMimeType: 'application/json'` | ✅ | ❌ | ❌ |
| 评论审核 | ✅ | ✅（fallback） | ✅（fallback） |
| 自动回复 | ✅ | ✅（fallback） | ✅（fallback） |
| 免费额度 | 20 次/天 | 500k tokens/天 | 10M tokens/天 |
| API 类型 | Google SDK | OpenAI 兼容 | OpenAI 兼容 |
| 多 Key 轮换 | ✅ | ✅ | ✅ |

**关键限制说明：**

- **图片识别（OCR）** 是 Gemini 的独占能力，用于 KYC 身份证识别。Groq 和 DeepSeek 不支持多模态输入。
- **`responseMimeType: 'application/json'`** 是 Gemini SDK 的特性，Groq/DeepSeek 使用 OpenAI 兼容 API，需要通过 `extractJsonObject()` 方法从文本响应中提取 JSON。
- **评论审核和自动回复** 在所有 Provider 上都可用，Gemini 不可用时自动 fallback 到 Groq 或 DeepSeek。

---

## 10. 总结

多 Provider 抽象层是 AI 服务从 Gemini 单点依赖演进为弹性多 Provider 架构的关键重构。核心收益：

| 维度 | 之前（单 Provider） | 之后（多 Provider） |
|------|-------------------|-------------------|
| 可用性 | Gemini 配额耗尽 → 服务完全不可用 | 自动 fallback → 服务持续可用 |
| 每日请求上限 | 20 次（Gemini 免费层） | 20 + 14,400 + 无限制（取决于配置的 Provider） |
| 可扩展性 | 新增 Provider 需修改 AiService 核心逻辑 | 只需实现接口 + 注册，无需修改编排逻辑 |
| 运维 | 手动切换 Provider | Admin UI 可视化配置，实时生效 |
| 监控 | 单一 Provider 用量 | 每个 Provider 独立用量追踪 |

**相关文档：**

- [AI Provider 抽象层架构文档](../../architecture/AI_PROVIDER_ABSTRACTION_ARCHITECTURE.md) — 完整的接口定义、实现指南和代码映射
- [Groq API Key 指南](../../groq-api-key-guide.md) — 如何获取 Groq API Key
- [DeepSeek API Key 指南](../../deepseek-api-key-guide.md) — 如何获取 DeepSeek API Key
