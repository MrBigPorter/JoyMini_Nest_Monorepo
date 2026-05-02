# 安全工具链：Zod 验证 + PII 脱敏 + XSS 防护

## 概述

[`security-utils.ts`](apps/admin-next/src/lib/security-utils.ts) 模块是管理后台的前端安全工具包，在浏览器/客户端层面提供全面的防御层。它在单个 276 行文件中涵盖了五个安全关注点：输入验证模式（Zod）、PII 数据脱敏、XSS/消毒防护、SQL 注入启发式检测和密码强度评估。

与后端安全（速率限制、CSRF 令牌、认证守卫）不同，该模块处理浏览器在**数据离开客户端之前**可以做的事情——防止日志中意外泄露 PII、及早捕获明显的注入尝试、在前端强制执行输入格式约束。

---

## 1. Zod 验证模式

五个 Zod 模式为常见的后台表单字段提供了类型安全、运行时验证的字符串和数字约束。每个模式都导出一个可复用的模式，可以组合成更大的表单验证对象。

| 模式 | 类型 | 关键约束 | 业务规则 |
|--------|------|----------------|---------------|
| [`phoneSchema`](apps/admin-next/src/lib/security-utils.ts:11) | `z.string()` | 10–15 字符, `^\+?[1-9]\d{6,14}$` | 国际格式，可选 `+` 前缀 |
| [`emailSchema`](apps/admin-next/src/lib/security-utils.ts:20) | `z.string()` | `.email()`, 最多 100 字符 | 标准邮箱格式 |
| [`usernameSchema`](apps/admin-next/src/lib/security-utils.ts:28) | `z.string()` | 2–50 字符, `/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/` | 字母数字 + 下划线 + 中文 |
| [`passwordSchema`](apps/admin-next/src/lib/security-utils.ts:40) | `z.string()` | 8–128 字符, 必须包含 `[a-z]` + `[A-Z]` + `\d` | POSIX 兼容密码策略 |
| [`amountSchema`](apps/admin-next/src/lib/security-utils.ts:49) | `z.number()` | 0 ≤ x ≤ 999999.99, 0.01 的倍数 | 金融精度，不允许负数 |

### 使用模式

```typescript
import { usernameSchema, passwordSchema } from '@/lib/security-utils';

const loginSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
});

const result = loginSchema.safeParse({ username: 'admin', password: 'Weak1' });
// result.success === false — 密码缺少大写字母
```

相较于内联使用 `z.string().min().max()` 的关键优势在于**一致性**：相同的模式在登录表单、用户创建弹窗、个人资料编辑器和后台用户管理页面中复用，确保所有地方的验证规则完全一致。

---

## 2. PII 脱敏 — 5 个脱敏函数

五个脱敏函数遵循**最小必要披露**原则：只显示足以识别记录的信息，同时使敏感部分不可见。所有函数在输入长度不足时会短路返回。

| 函数 | 示例 | 模式 |
|----------|---------|---------|
| [`maskPhone()`](apps/admin-next/src/lib/security-utils.ts:59) | `13812341234` → `138****1234` | 保留前 3 位，掩码中间 4 位，保留后 4 位 |
| [`maskBankCard()`](apps/admin-next/src/lib/security-utils.ts:68) | `6222021234567890123` → `6222****0123` | 保留前 4 位，掩码 8-12 位，保留后 4 位 |
| [`maskIdCard()`](apps/admin-next/src/lib/security-utils.ts:77) | `110101199001011234` → `1101****1234` | 保留前 4 位，掩码 10 位，保留后 4 位 |
| [`maskEmail()`](apps/admin-next/src/lib/security-utils.ts:86) | `user@example.com` → `u***@example.com` | 保留本地部分首字符，`***`，然后域名 |
| [`maskName()`](apps/admin-next/src/lib/security-utils.ts:98) | `李小明` → `李*明`, `张三` → `张*` | 2 字: 首+*; 3 字+: 首+*+尾 |

### 边界情况处理

```typescript
maskPhone('138');        // '138' — 太短，原样返回
maskPhone('13812');      // '13812' — 少于 7 字符，原样返回
maskName('张');          // '张' — 单字符，原样返回
maskEmail('a@b.com');    // 'a***@b.com' — 单字符本地部分
maskBankCard('1234');    // '1234' — 太短
```

这些函数在后台的用户详情视图、KYC 审核页面、财务交易日志以及任何显示个人数据的组件中使用。它们确保即使页面被截图或审查，PII 仍然部分模糊。

---

## 3. XSS 防护 — 三层防御

三个函数构成了递进的 XSS 消毒管道：

### 第一层：[`escapeHtml()`](apps/admin-next/src/lib/security-utils.ts:109) — 字符级转义

将五个危险的 HTML 字符替换为对应的实体：

```typescript
escapeHtml('<script>alert("xss")</script>');
// '<script>alert("xss")</script>'
```

字符映射：
| 原始 | 转义后 |
|-----|---------|
| `&` | `&` |
| `<` | `<` |
| `>` | `>` |
| `"` | `"` |
| `'` | `&#039;` |

### 第二层：[`stripHtml()`](apps/admin-next/src/lib/security-utils.ts:123) — 标签移除

通过正则表达式移除所有 HTML 标签，只留下文本内容：

```typescript
stripHtml('<p>Hello <b>world</b></p><img src=x onerror=alert(1)>');
// 'Hello world'
```

### 第三层：[`sanitizeInput()`](apps/admin-next/src/lib/security-utils.ts:130) — 强力清洗

去除 `<>`，移除 `script`（不区分大小写），并消除 `on*=` 事件处理器：

```typescript
sanitizeInput('<img src=x onerror=alert(1)><SCRIPT>evil()</SCRIPT>');
// 'img src=x error=alert(1)evil()'
```

### XSS 检测：[`containsXss()`](apps/admin-next/src/lib/security-utils.ts:188)

一个基于正则表达式的检测函数，检查六种 XSS 攻击模式：

| 模式 | 目标 |
|---------|--------|
| `<script\b...<\/script>` | Script 标签（包括嵌套内容） |
| `javascript:` | 伪协议 URL |
| `on\w+\s*=` | 内联事件处理器 |
| `<iframe` | 嵌入式框架 |
| `<object` | 嵌入式对象 |
| `<embed` | 嵌入式插件 |

---

## 4. SQL 注入启发式检测

[`containsSqlInjection()`](apps/admin-next/src/lib/security-utils.ts:161) 函数根据 11 个 SQL 关键字及其引号变体检查字符串：

```typescript
const sqlKeywords = [
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'DROP',
  'UNION', 'OR', 'AND', 'EXEC', 'EXECUTE', 'xp_', 'sp_',
];
```

它同时检查原始关键字和包裹在单/双引号中的变体（例如 `'OR`、`"OR`），这可以捕获常见的注入模式，如 `' OR '1'='1`。

> **注意**：这只是一个**前端启发式检查**——一个标记可疑输入的信号。后端必须始终使用参数化查询（Prisma 默认这样做）作为真正的防御手段。此函数用于捕获后台搜索字段中类似 SQL 的意外输入，并阻止其到达后端。

---

## 5. 密码强度与生成

### [`checkPasswordStrength()`](apps/admin-next/src/lib/security-utils.ts:239)

将密码从 0（最弱）到 4（最强）评分，并提供可操作的反馈：

| 分数 | 标准 | 示例反馈 |
|-------|----------|------------------|
| 0 | 长度 < 8 | "密码至少8个字符" |
| 1 | 仅 ≥8 字符 | "需要小写字母" |
| 2 | + 小写字母 | "需要大写字母" |
| 3 | + 大写字母 | "需要数字" |
| 4 | + 数字 + 特殊字符 | "包含特殊字符（加分项）" |

返回 `{ score: number, feedback: string[] }` — `feedback` 数组列出缺少的内容，使 UI 能够在用户输入时显示实时验证提示。

### [`generateSecurePassword()`](apps/admin-next/src/lib/security-utils.ts:269)

使用 `crypto.getRandomValues()` 生成密码学安全的随机密码：

```typescript
generateSecurePassword();       // 'aB3!xY7#zK9@pQ2$'
generateSecurePassword(24);     // 更长的版本，24 字符
```

字符集：`a-z A-Z 0-9 !@#$%^&*`（共 72 个字符）。来自 `getRandomValues()` 的每个字节映射到 `charset[byte % 72]`，提供近乎均匀的分布。

---

## 6. CSRF 令牌工具

与安全函数一起提供的还有两个 CSRF 辅助函数：

- [`generateCsrfToken()`](apps/admin-next/src/lib/security-utils.ts:143)：通过 `crypto.getRandomValues()` 生成 64 字符的十六进制令牌（32 字节随机数）
- [`validateCsrfToken()`](apps/admin-next/src/lib/security-utils.ts:154)：将令牌与存储值进行比较，并验证长度为 64

这些函数补充了后端 CSRF 双重中间件系统（参见 [CSRF 双重中间件](../api/csrf-double-middleware-protection.md)），提供了后台表单使用的客户端令牌生成能力。

---

## 7. 综合安全检查

[`securityCheck()`](apps/admin-next/src/lib/security-utils.ts:203) 函数运行所有三项检查（SQL 注入、XSS、长度）并返回结构化结果：

```typescript
securityCheck("<script>alert('xss')</script> SELECT * FROM users");
// {
//   isSafe: false,
//   threats: ['SQL注入', 'XSS攻击'],
//   cleaned: 'alert(xss)  FROM users'  // 消毒后的输出
// }
```

这是接受自由文本（搜索框、原因字段、备注）的表单输入字段的推荐入口点。它提供：
- **`isSafe`**：布尔标志，用于条件性 UI 反馈
- **`threats`**：检测到的威胁类型的人类可读列表
- **`cleaned`**：消毒后的字符串，安全用于显示/发送

---

## 8. 集成映射

这些工具函数在管理后台架构中的集成方式：

| 函数 | 使用方 | 用途 |
|----------|---------|---------|
| `phoneSchema` | 用户表单、KYC 表单 | 提交前验证电话输入 |
| `amountSchema` | 财务调整、优惠券创建 | 强制执行金融精度 |
| `maskPhone/maskName/maskIdCard` | 用户详情、KYC 审核、财务日志 | 在只读视图中模糊 PII |
| `escapeHtml` | 富文本预览、通知消息 | 安全渲染用户内容 |
| `sanitizeInput` | 搜索字段、原因文本框 | 清洗自由文本输入 |
| `checkPasswordStrength` | 管理员创建/编辑密码表单 | 显示实时强度计 |
| `generateSecurePassword` | "生成密码"按钮 | 一键生成强密码 |
| `securityCheck` | 文本字段的输入变更处理器 | 综合验证 |

### PII 脱敏的关键场景

三个管理后台上下文中，未脱敏的 PII 风险最高：

1. **KYC 审核页面** — 审核员可以看到身份证、自拍和个人信息。`maskIdCard()` 和 `maskName()` 可防止在浏览器开发者工具或截图中意外暴露数据。
2. **用户详情面板** — 显示电话和邮箱。`maskPhone()` 和 `maskEmail()` 确保日志和缓存的 React 组件不包含原始 PII。
3. **财务交易日志** — 可能涉及银行卡。渲染前应用 `maskBankCard()`。

---

## 9. 设计决策

| 决策 | 理由 |
|----------|-----------|
| **单文件而非拆分** | 模块仅 276 行——拆分会增加导入开销而无益处 |
| **Zod 而非自定义正则** | Zod 提供类型推断、可组合模式和支持本地化的错误消息 |
| **`crypto.getRandomValues` 优于 `Math.random`** | 密码学安全，CSRF 令牌生成和密码生成所需 |
| **启发式 SQL/XSS 检测** | 前端检测本质上是概率性的——捕获明显案例，减少后端负载，但绝不替代服务端验证 |
| **中文错误消息** | 后台操作员是中文使用者；错误反馈使用他们的语言 |

---

## 关键要点

1. **五个 Zod 模式**为所有后台表单中的电话、邮箱、用户名、密码和金额字段提供一致、可复用的验证。
2. **五个 PII 脱敏函数**（`maskPhone`、`maskBankCard`、`maskIdCard`、`maskEmail`、`maskName`）遵循"刚刚好够看"的模式，并妥善处理边界情况。
3. **三层 XSS 防御**——字符转义（`escapeHtml`）、标签剥离（`stripHtml`）和强力消毒（`sanitizeInput`）——覆盖不同使用场景。
4. **`securityCheck()`** 提供一站式综合防护，同时检测 SQL 注入、XSS 和超长输入。
5. **密码工具**（`checkPasswordStrength`、`generateSecurePassword`）在后台用户管理中实现实时强度计和一键强密码生成。
6. **前端安全是补充而非替代**——所有这些检查在请求离开浏览器之前运行，但后端必须独立验证一切。
