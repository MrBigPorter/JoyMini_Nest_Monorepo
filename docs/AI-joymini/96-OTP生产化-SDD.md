# 96 · 生产 OTP 收口（T1-1 / P0-4）

> 状态: 🟡 **部分实施**（2026-11-12）——代码路径已收口，真实短信供应商待接入
> 日期: 2026-11-12
> 关联: [#85 §P0-4](./85-生产化差距审计与企业上线清单.md)、[#87](./87-全项目问题总清单.md)、[`current-task.md`](../current-task.md) T1-1
> 前置阅读: [#85 §P0-4](./85-生产化差距审计与企业上线清单.md)

---

## 0. 一句话

生产环境的 OTP 有三个致命问题：**验证码明文进日志**、**pepper 为空时哈希形同虚设**、**生产分支根本不发短信**。
本次一次修掉这三条，另顺带修掉两处此前未登记的逻辑 bug，并把「发短信」抽成 `SmsProvider` 接口——
供应商账号接入后只替换实现，`OtpService` 不用再动。

---

## 1. 现状（逐条核过代码）

| # | 问题 | 位置 | 后果 |
|:--:|---|---|---|
| 1 | `console.log('[OTP]==> ... code=...')` 在**所有**环境执行 | `otp.service.ts:75` | 能看日志的人可直接登录 / 提现 |
| 2 | 生产分支只有 `// TODO` + `return true` | `otp.service.ts:81` | 用户收不到码，注册登录全断 |
| 3 | `OTP_PEPPER = process.env.OTP_PEPPER \|\| ''`，未配置不报错 | `otp.service.ts:14` | 哈希退化为 `sha256(phone:code:)`，6 位码离线可枚举 |
| 4 | `isProd` 判据是「等于 production」，其余一律当开发 | `otp.service.ts:18` | `NODE_ENV` 拼错 / 缺失 → 固定码 `999999` 且接口直接返回 |
| 5 | `requestIp: null` 写死 | `otp.service.ts:71` | 只能按手机号限流，换号即可绕过 |
| 6 | **`verifyTimes` 每次尝试被 +2**（`updateMany` 一次 + 后续 `update` 再一次） | `otp.service.ts:130-159`（改前） | `maxVerifyTimes=5` 实际只允许 3 次 |
| 7 | 查询用未清理的 `phone`，哈希用 `phone.trim()` 后的 `p` | `otp.service.ts:101` vs `:95`（改前） | 手机号带空格时查不到刚创建的单，报 `Otp not found` |

第 6、7 条为本次新发现，此前未在 #85 / #87 登记。

---

## 2. 改动清单

| 文件 | 改动 |
|---|---|
| `apps/api/src/client/otp/sms.provider.ts` | **新建**：`SmsProvider` 接口 + `ConsoleSmsProvider`（开发）+ `UnconfiguredSmsProvider`（生产占位，**发送即抛错**） |
| `apps/api/src/client/otp/otp.module.ts` | 以 `'SMS_PROVIDER'` 字符串 token 注册工厂，按 `NODE_ENV` 选择实现 |
| `apps/api/src/client/otp/otp.service.ts` | 删明文日志；`isProd` → `isDev`（fail-closed）；删重复计数；写入 `requestIp`；`where` 统一用 `p`；发送改走 `SmsProvider`；`sendStatus` 不再抢跑 |
| `apps/api/src/client/otp/otp.controller.ts` | `@RealIP()` 收取客户端 IP 并传给 service |
| `apps/api/src/main.ts` | 生产环境 `OTP_PEPPER` 缺失或长度 < 16 → **启动即失败** |

---

## 3. 三个关键决策

### 3.1 fail-closed：只认「明确是开发」

```ts
const isDev = process.env.NODE_ENV === 'development';
```

改前是 `isProd = NODE_ENV === 'production'`，即「除生产外全算开发」。
`NODE_ENV` 拼成 `Production` / `prod` / 忘记配置，都会掉进开发分支：验证码固定 `999999`，
且接口直接把码返回给调用方 ——**任何人输入 `999999` 即可登录任意手机号**。

改为只认 `development` 后，其余一切情况按生产处理：随机码、不返回码、发送失败即抛错。

### 3.2 状态不能抢在实际发生之前写

改前：先 `create({ sendStatus: SENT })`，再去 `sms.send()`。
发送抛错时，库里留下一条「已发送」的假记录。

改后：

```
create({ sendStatus: PENDING })
  ├─ send 成功 → update SENT
  └─ send 失败 → update FAILED + throw
```

三种结局都如实反映现实：

| 结局 | `sendStatus` | 接口返回 |
|---|:--:|---|
| 发送成功 | `SENT`(2) | 正常 |
| 发送失败 | `FAILED`(3) | 抛错给前端 |
| 未走到发送即中断 | `PENDING`(1) | 抛错 |

与 [#95](./95-提现冻结状态机-SDD.md) 同一条原则：**谁拿到结果，谁才能写终态。**

### 3.3 接口 + 工厂，让供应商可替换

`SmsProvider` 是 interface，运行时不存在，不能当 DI token，故用字符串 `'SMS_PROVIDER'` 注册：

```ts
providers: [
  OtpService,
  {
    provide: 'SMS_PROVIDER',
    useFactory: () =>
      process.env.NODE_ENV === 'production'
        ? new UnconfiguredSmsProvider()
        : new ConsoleSmsProvider(),
  },
]
```

`UnconfiguredSmsProvider.send()` 直接抛 `NotImplementedException`。
**生产未接供应商时，表现是「明确报错」，不是「假装成功」。**

---

## 4. 验证

| 项 | 结果 |
|---|---|
| `yarn workspace @lucky/api tsc --noEmit` | EXIT=0 |
| 全量测试 | **308 passed**；3 例失败仍是 `auth` / `flash-sale` 两个已知过期 suite，与本次无关 |
| `grep -c 'console.log.*code=' otp.service.ts` | 0 |
| `grep -c 'sendSmsDev' otp.service.ts` | 0 |

未做：真机收码验证（缺供应商账号）。

---

## 5. 尚未完成（诚实清单）

1. **真实短信供应商未接入** —— 生产环境调用 `sms.send()` 会抛 `NotImplementedException`。
   候选：Semaphore（菲律宾本地）、Twilio（全球）。接入时只需新增一个 `implements SmsProvider` 的类并改工厂。
2. **pepper 存在两个读取时机（本次遗留，见 #87 N-19）**：
   `otp.service.ts:16` 在**模块 import 时**读 `process.env`，而 `main.ts` 的校验发生在 `NestFactory.create()` **之后**（`.env` 此时才加载）。
   若 `OTP_PEPPER` 只写在 `.env` 文件中（非真实环境变量），会出现「校验通过、实际哈希用的是空串」。
   Docker `env_file` 注入真实环境变量时不触发；本地以生产模式跑 `.env` 时会触发。
   **修法**：`OtpService` 注入 `ConfigService`，在调用时读取，保证单一数据来源。
3. **`requestIp` 只写入，未参与限流** —— 现有限流仍只看手机号。接入 IP 维度限流需 Redis 计数器（配合 #87 N-18 一并考虑）。
4. **过期判断仍手写** —— 现为 DB + `isBefore(req.expiresAt, now)`；改 Redis TTL 可省掉这一步，也让 OTP 天然过期。
5. **`return '9999'` 未动** —— 历史魔法值，Flutter 侧 `optVerifyApi` 返回 `Future<void>` 直接丢弃，无人消费。改公开返回结构需单独评估。
6. **发送失败后 60 秒内无法重试** —— 限流查询不区分 `sendStatus`，一次供应商抖动会让用户被锁 60 秒。

---

## 6. 不做的事（边界）

- 不改 `otp.util.ts` 的哈希算法（`sha256(phone:code:pepper)`）。若需抗更强爆破，应换 bcrypt/argon2，属独立评估。
- 不改 OTP 的 TTL、尝试次数、限流间隔等业务参数。
- 不改 `auth.service.ts` 中同样读取 `OTP_PEPPER` 的两处（`:581`、`:732`）——它们走 `ConfigService`，不受本次影响，但也意味着**哈希口径必须保持一致**，换实现时要一起改。
