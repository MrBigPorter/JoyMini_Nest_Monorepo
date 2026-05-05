# 切换到 DeepSeek 付费 API 翻译方案

## 问题背景

当前翻译使用 Groq API，遇到严重限流：
- Groq 免费层 500K tokens/天/Key，每天只能翻译 ~5-10 篇文章
- 429 频繁触发，Key 被封锁数十分钟到数小时
- 少量 Key 轮换也不够，翻译进度极慢
- 导致"很多文章翻译不全"，无法录屏制作内容

## 方案概述

项目已经内置了 DeepSeek Provider，只需要接入付费 API Key 并切换即可。

### 成本对比

| 项目 | Groq（当前） | DeepSeek 付费 |
|------|-------------|---------------|
| 费用 | 免费 | **~¥5-20（全部 114 篇 × 5 语言）** |
| 每日额度 | 500K tokens/天/Key | **不限（按量付费）** |
| 429 限流 | 经常发生，严重 | **极少发生** |
| 翻译质量 | Llama 3.3 70B | **DeepSeek-V3（更强）** |
| 全量翻译完成时间 | **数天（被 429 卡）** | **~1-2 小时** |
| 实现复杂度 | — | **代码改动已完成** |

## ✅ 已完成的代码修改

项目已修改两个文件，无需额外编码：

### 修改 1: [`DeepSeekProvider`](apps/api/src/common/ai/providers/deepseek.provider.ts) — 移除免费层限制

| 位置 | 修改内容 |
|------|---------|
| `DAILY_LIMIT` | `10_000_000` → `999_999_999_999`（无效化日限额） |
| `generateText()` 日限额检查块 | 移除 `currentKey.dailyTokens >= DAILY_LIMIT` 逻辑，仅保留注释 |
| `rotateToNextKey()` | `isExhausted` 硬编码为 `false`（付费 Key 无日限额） |

### 修改 2: [`AiService`](apps/api/src/common/ai/ai.service.ts) — 切换提供商优先级

**旧优先级**: Groq → DeepSeek → Gemini
**新优先级**: DeepSeek (paid, no rate limits) → Groq (free, heavy 429) → Gemini (last resort)

```typescript
// Priority: DeepSeek (paid, no rate limits) > Groq (free, heavy 429) > Gemini (last resort)
const deepseekKey = this.configService.get<string>('DEEPSEEK_API_KEY');
if (deepseekKey) {
  return { provider: 'deepseek', model: 'deepseek-chat', strict: false };
}

const groqKey = this.configService.get<string>('GROQ_API_KEY');
if (groqKey) {
  return { provider: 'groq', model: 'llama-3.3-70b-versatile', strict: false };
}

// Last resort: Gemini
return { provider: 'gemini', model: 'gemini-2.5-flash', strict: false };
```

## 执行步骤

### Step 1: 获取 DeepSeek 付费 API Key

1. 访问 [platform.deepseek.com](https://platform.deepseek.com) 注册账号
2. 进入 API Keys 页面创建新的 Key
3. 充值少量余额（建议先充 ¥20，足够翻译全部文章 2-3 轮）
4. 复制 API Key（格式: `sk-xxx`）

### Step 2: 配置环境变量

只需将 DeepSeek 付费 Key 写入环境变量，系统会自动优先使用 DeepSeek：

```bash
# apps/api/.env 或 deploy/.env.dev / deploy/.env.prod
DEEPSEEK_API_KEY=sk-your-paid-key-here
```

**不需要注释或删除 `GROQ_API_KEY`** — 系统现在优先检测 DeepSeek，只有 DeepSeek 不可用时才回退到 Groq。

### Step 3: 重启 API 服务

```bash
# 开发环境
yarn workspace @lucky/api start:dev

# 生产环境需要重启 API 容器或进程
```

### Step 4: 触发全量翻译

通过 Admin 后台的翻译管理页面操作：

1. 登录 Admin 后台
2. 进入 Translation Quality 页面
3. 点击"Detect Incomplete"检测不完整文章
4. 点击"Retranslate All"批量重新翻译

或者通过 API：

```bash
# 检测不完整翻译
GET /v1/admin/blog/translation/detect-incomplete?lang=en

# 批量重新翻译
POST /v1/admin/blog/translation/retranslate-incomplete
{"lang": "en"}
```

对每个目标语言（en, fr, ja, ko, de）重复上述操作。

### Step 5: 验证翻译结果

翻译完成后：
1. 重新运行检测确认完成率 100%
2. 在 frontend-blog 上查看文章显示是否完整
3. 录屏制作内容

## 可能遇到的问题

| 问题 | 解决方案 |
|------|---------|
| DeepSeek 付费 Key 也被限流 | DeepSeek 付费层限流很宽松（通常 200+ RPM），基本不会发生 |
| 翻译质量下降 | DeepSeek-V3 翻译质量优于 Llama 3.3，不用担心 |
| 余额不足中断 | 充值即可继续，¥20 足够全部翻译 2-3 轮 |
| 已有部分翻译被覆盖 | Retranslate 会覆盖现有翻译，建议先检测确认哪些需要重译 |

## 回滚方案

如果 DeepSeek 出现问题，恢复 Groq：
1. 重新设置 `GROQ_API_KEY` 环境变量
2. 移除 `DEEPSEEK_API_KEY` 环境变量
3. 重启 API 服务
4. 系统会自动切回 Groq（若未来需要源码回滚，`git checkout` 两个修改文件）

## 总结

**成本极低**（¥5-20 全部搞定） + **代码修改已完成** + **立即可用**（只需配置 Key）= 最推荐的解决方案。
