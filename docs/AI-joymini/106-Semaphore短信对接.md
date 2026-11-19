# 106 · Semaphore 短信对接文档（T1-1）

> 日期：2026-11-20
> 关联：T1-1、[#96 OTP 生产化](./96-OTP生产化-SDD.md)
> 状态：代码已接入；待 Semaphore 账号 / Sender Name / 真实短信验证

---

## 1. 选型

| 供应商 | PH OTP 成本 | 结论 |
|---|---:|---|
| **Semaphore** | ₱0.56/段，OTP 2 credits ≈ **₱1.12/条** | **选用**：PH 本地、OTP 专用路由、表单 API 简单 |
| Movider | ≈₱0.38/条 | 备选：更便宜，但文档/充值审核较弱 |
| Twilio | ≈₱14/条 | 不选：PH 需注册 Sender ID（约 2 周 + 运营商材料） |

## 2. 输入格式

```
POST https://api.semaphore.co/api/v4/otp
Content-Type: application/x-www-form-urlencoded
```

| 字段 | 必填 | 本项目取值 |
|---|---|---|
| `apikey` | 是 | `SEMAPHORE_API_KEY` |
| `number` | 是 | `639XXXXXXXXX`（E.164 去掉 `+`） |
| `message` | 是 | `SEMAPHORE_OTP_MESSAGE`，默认 `Your JoyMini verification code is {otp}. Do not share it.` |
| `code` | 否 | 我们生成的 6 位码；传了就不自动生成 |
| `sendername` | 否 | `SEMAPHORE_SENDER_NAME`；不传用账户默认名 |

示例：

```
apikey=***&number=639171234567&message=Your JoyMini verification code is {otp}. Do not share it.&code=123456&sendername=JOYMINI
```

## 3. 输出格式

HTTP 200 返回 JSON 数组，OTP 端点额外带 `code`：

```json
[
  {
    "message_id": 12345,
    "recipient": "639171234567",
    "message": "Your JoyMini verification code is 123456. Do not share it.",
    "code": 123456,
    "sender_name": "JOYMINI",
    "network": "Globe",
    "status": "Pending",
    "type": "Single",
    "source": "Api",
    "created_at": "...",
    "updated_at": "..."
  }
]
```

- `status`：`Queued` / `Pending` / `Sent` / `Failed` / `Refunded`
- **200 只代表受理，`Pending` 不代表已送达**
- 本项目把 `message_id` 写入 `sms_message_id`，`status` 写入 `send_result`

## 4. 需要配置的 API Key 与变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `SMS_PROVIDER` | 是 | `semaphore`；开发可 `console`，未接入可 `none` |
| `SEMAPHORE_API_KEY` | 是 | Semaphore 控制台生成；放在表单参数，不是 Bearer |
| `SEMAPHORE_SENDER_NAME` | 否 | 已审核的 Sender Name；不传用默认 |
| `SEMAPHORE_OTP_MESSAGE` | 否 | 模板，必须含 `{otp}` |
| `SMS_HTTP_TIMEOUT_MS` | 否 | 默认 10000 |

生产启动校验：
- `SMS_PROVIDER=console` → 直接拒绝启动
- `SMS_PROVIDER=semaphore` 但缺 key → 直接拒绝启动
- `SMS_PROVIDER=none` → 允许启动但打 error 日志，发送时明确失败

## 5. 注意事项

1. **Sender Name 必须审核通过**；没有默认名且不传 `sendername` 会报错
2. **OTP 路由 2 credits / 160 字符**；正文用 GSM-7，控制在 160 字符内
3. 正文以 `TEST` 开头会被静默丢弃，测试时不要用 `TEST...`
4. `POST /messages` 限 120 次/分钟；OTP 端点官方写“不限流”，第三方文档有 30 次/分钟说法，保留应用侧 5 次/60 秒限流
5. **不在代码里自动重试**：避免同一条 OTP 重复发送/扣费；失败后用户可立即重新申请（限流已排除 FAILED）
6. 日志不记录验证码、API key、完整手机号；只记录 provider、`message_id`、脱敏后 4 位

## 6. 未知 / 待账号确认

- 官方**没有公开错误响应 body schema**；实现只按 HTTP 状态分类（401/403、429、5xx、其他 4xx）
- Sender Name 审核材料与时长官方文档未写，需要控制台确认
- 计费是否含 VAT、最低充值、测试额度未统一说明
- 异步状态：`Pending` 后续可能变 `Failed/Refunded`；本次不做状态回查/回调
- OTP 端点限流官方与第三方说法冲突

## 7. 代码落点

- `apps/api/src/client/otp/sms.provider.ts` — `SmsSendResult` + Provider 契约
- `apps/api/src/client/otp/semaphore-sms.provider.ts` — Semaphore 实现
- `apps/api/src/client/otp/otp.module.ts` — 按 `SMS_PROVIDER` 选择实现，缺配置 fail-closed
- `apps/api/src/client/otp/otp.service.ts` — 写入 provider/messageId/status；失败可重试；pepper 改为调用时读取
- `apps/api/src/client/otp/otp.dto.ts` — PH 手机号统一转 E.164
- `apps/api/src/app.module.ts` / `main.ts` — Joi 与生产启动校验

## 8. 上线验证

1. Semaphore 控制台：创建 API key、提交 Sender Name、充值
2. 生产 env 设置 `SMS_PROVIDER=semaphore`、`SEMAPHORE_API_KEY`、`SEMAPHORE_SENDER_NAME`
3. 重启后端，确认无启动错误
4. 用真实 PH 号码请求 OTP，查 `sms_verification_codes`：`send_status=2`、`sms_provider=semaphore`、`sms_message_id` 非空
5. 用收到的码验证成功
6. 观察 24h 的 `send_status=3`、429/5xx 日志
