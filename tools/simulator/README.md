# 合成 AI 客服流量 — 模拟器（P0）

`tools/simulator/` 是生产合成流量的无头客户端。本目录提供**专用渠道探测**、**账号池 provisioning**、**场景库**、**人类化节奏**、**Socket 单会话 driver** 与**并发 runner + 覆盖报告**。

所有流量只落在专用渠道 `simulation_support_v1`，不会创建渠道、不会调用任何 `/confirm` 接口，也不会执行存款/取款/购买等真实资金流程。

## 文件

| 文件            | 作用                                                                      |
| --------------- | ------------------------------------------------------------------------- |
| `config.mjs`    | 读取 `SIM_*` 环境变量（不读 `.env`），提供默认值与安全阀                  |
| `provision.mjs` | 建号 CLI + `provisionAccounts()`；渠道存在性探测                          |
| `scenarios.mjs` | 9 个 intent 的场景库、加权随机、槽位渲染                                  |
| `humanize.mjs`  | 5–60 秒人类化延迟、语气词/轻量错别字扰动、用户画像                        |
| `driver.mjs`    | 单会话 driver：`GET /chat/business` + Socket `send_message` + 等 AI 回复  |
| `run.mjs`       | 并发 runner：账号轮转、intent 去重、SIGINT 停止调度、token 刷新落盘       |
| `report.mjs`    | `summarize()` 覆盖统计 + `writeReport()` 写 `summary.json`/`events.jsonl` |
| `*.test.mjs`    | Node 内置测试，纯函数 + mock 网络                                         |

运行态文件：`tools/simulator/.runtime/accounts.json`（已 gitignore，权限 `600`）。

## 前置条件

- Node.js >= 18（使用内置 `fetch`，无需 `npm install`）
- 生产环境已配置固定 OTP（`OTP_PROVIDER=fixed` 或 `OTP_FIXED_MODE=true`）；
  生产环境还需要 `OTP_ALLOW_FIXED_IN_PROD=true` 作为第二道确认，否则应用启动失败；完全未配置固定 OTP 时才会在发送阶段返回 501。
- 渠道已由人工创建并启用（见下一节）。

## 1. 创建专用渠道（一次性，人工）

脚本**不会**自动创建渠道。任选一种方式：

### Admin UI

1. 打开 admin 后台 `/support-channels`
2. 新建渠道：
   - `id`: `simulation_support_v1`
   - `name`: `Simulation Support`
   - 保持启用（创建时默认 `isActive=true`）

### Admin API

```bash
curl -X POST 'https://api.joyminis.com/api/v1/admin/support-channels' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <ADMIN_TOKEN>' \
  -d '{"id":"simulation_support_v1","name":"Simulation Support","description":"Synthetic AI traffic (P0)"}'
```

停用/重新启用：

```bash
curl -X PATCH 'https://api.joyminis.com/api/v1/admin/support-channels/simulation_support_v1/toggle' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <ADMIN_TOKEN>' \
  -d '{"isActive":false}'
```

## 2. 配置

| 环境变量            | 默认值                            | 说明                       |
| ------------------- | --------------------------------- | -------------------------- |
| `SIM_API_BASE_URL`  | `https://api.joyminis.com/api`    | API 根地址（已含 `/api`）  |
| `SIM_SOCKET_URL`    | `https://api.joyminis.com/events` | Socket 地址（driver 使用） |
| `SIM_BUSINESS_ID`   | `simulation_support_v1`           | 专用渠道 ID                |
| `SIM_ACCOUNT_COUNT` | `30`                              | 默认建号数量（1–100）      |
| `SIM_CONCURRENCY`   | `5`                               | 并发，安全阀上限 5         |
| `SIM_OTP_CODE`      | `999999`                          | 固定 OTP                   |
| `SIM_RUNTIME_DIR`   | `tools/simulator/.runtime`        | 运行态目录                 |

示例：

```bash
SIM_API_BASE_URL='https://api.joyminis.com/api' \
SIM_ACCOUNT_COUNT=30 \
node tools/simulator/provision.mjs
```

## 3. 建号

先看计划，不联网、不写文件：

```bash
node tools/simulator/provision.mjs --count 2 --dry-run
```

正式建 2 个临时账号：

```bash
node tools/simulator/provision.mjs --count 2
```

正式建 30 个（默认值）：

```bash
node tools/simulator/provision.mjs --count 30
```

执行过程：

1. `GET /api/health` 获取 CSRF cookie + `X-CSRF-Token`（正规握手，不绕过）
2. 生成 PH 手机号 `+63917` + 7 位数字
3. `POST /v1/otp/request {phone}`
4. `POST /v1/otp/verify {phone, code}`
5. `POST /v1/auth/login/otp {phone}`，读取 `data.tokens.accessToken`、`data.tokens.refreshToken` 与 `data.user.id`（兼容 `data.id`）
6. 每 5 个账号等待 60 秒，避免 OTP IP 限流
7. 每个账号成功后**立即**原子写入 `accounts.json`，中途失败不会丢已建账号

账号对象：

```json
{
  "phone": "+63917*******",
  "userId": "cm...",
  "token": "<accessToken>",
  "refreshToken": "<refreshToken>",
  "deviceId": "sim-+63917*******-ab12cd34"
}
```

`--skip-channel-check` 会打印醒目警告；没有探测渠道就建号可能把账号写进错误的渠道假设里，只在明确知道渠道已存在时使用。

选项：

```text
--count <n>             新账号数量（默认 SIM_ACCOUNT_COUNT）
--start-index <n>       账号编号起点（默认沿用已有账号数）
--dry-run               只生成计划，不联网、不写文件
--replace               忽略已有 accounts.json 重新建号（不会删除服务端用户）
--skip-channel-check    跳过 /chat/business 渠道探测
--batch-size <n>        每批账号数（默认 5）
--batch-wait-ms <ms>    批间隔（默认 60000）
-h, --help              帮助
```

已有账号默认会保留并追加；新账号手机号会避开已有手机号。

### 渠道探测

建完第一个账号后，脚本会用该账号 token 调用：

```text
GET /v1/chat/business?businessId=simulation_support_v1
```

- 成功：继续建号
- `404`/`403`：立即停止，并提示先到 `/support-channels` 创建/启用渠道
- `401`：提示 token 失效，删除 `.runtime/accounts.json` 或使用 `--replace`

## 4. Token 过期与刷新

access token 会过期，长期运行时不要重新建号。用 `refreshToken` 刷新：

```js
// 在 tools/simulator 目录内运行；从仓库根则用 "./tools/simulator/provision.mjs"
import { loadConfig, refreshAccountToken } from "./provision.mjs";

const config = loadConfig();
const account = /* 从 accounts.json 读取 */;
const refreshed = await refreshAccountToken(config, account);

// 把 refreshed.token / refreshed.refreshToken 写回 accounts.json
```

`refreshAccountToken()` 调用 `POST /v1/auth/refresh {refreshToken}`，返回更新后的完整账号对象（`phone/userId/deviceId` 不变）。后续 runner 应在收到 `401` 时刷新一次、写回文件并重试当前请求；刷新失败（refresh token 也过期）才需要 `--replace` 重新建号。

## 5. 验证 token

建号完成后可抽查第一个账号（命令不会输出 token）：

```bash
node -e "const a=require('./tools/simulator/.runtime/accounts.json')[0]; fetch('https://api.joyminis.com/api/v1/auth/profile',{headers:{authorization:'Bearer '+a.token}}).then(async r=>{console.log('HTTP',r.status);console.log((await r.json()).data?.nickname ?? '');})"
```

预期 `HTTP 200`。

也可以直接查看文件结构（会显示 token，请勿粘贴到聊天/工单）：

```bash
jq 'map({phone:(.phone[0:6]+"****"),userId,deviceId})' tools/simulator/.runtime/accounts.json
```

## 6. 单会话 driver 冒烟

账号池建好后，可以用 driver 跑一条会话验证 Socket 链路：

```bash
node tools/simulator/driver.mjs --once --scenario order_status
```

可用场景 ID 见 `scenarios.mjs` 的 `SCENARIOS`（如 `order_status`、`rag_refund`、`special_transfer`）。
driver 会在收到 `ai_confirm` / `ai_transfer` 或 90 秒无回复时结束，**从不调用** `/confirm`；
退出码 0 表示会话完成且无错误、无超时。

## 7. 并发 runner 与报告

```bash
# 1 会话冒烟
node tools/simulator/run.mjs --once --concurrency 1

# 30 分钟压测：6 轮 × 5 并发 = 30 个会话
node tools/simulator/run.mjs --rounds 6 --concurrency 5

# 固定场景
node tools/simulator/run.mjs --once --concurrency 2 --scenario order_status
```

- 总任务数 = `rounds * concurrency`；并发上限 5。
- 账号池轮转使用，同一账号不会连续两次落在同一 intent（`excludeIntents`）。
- 单个会话异常只写入该条结果，不会中断进程。
- `SIGINT`（Ctrl+C）停止调度新会话，等待在途会话结束后写报告；再次 Ctrl+C 强制退出。
- driver 在 401 时刷新 token，runner 会把新 token 写回 `accounts.json`（权限 600）。
- 报告目录：`tools/simulator/.runtime/runs/<ISO>/`
  - `summary.json`：`conversations/replies/confirms/transfers/noReply/errors`、
    按 intent 的 `byIntent`，以及特殊场景 `special` 计数（特殊场景 intent 均为
    `general`，因此从 `byIntent` 拆出单独统计）。
  - `events.jsonl`：每行一个会话结果（场景、计数、时间戳、脱敏错误）。
- 报告与会话结果不含 token / 手机号。

## 8. 清理

```bash
# 删除本地账号池（只删本地文件，服务端用户仍存在）
rm -f tools/simulator/.runtime/accounts.json
```

- 服务端测试用户不会自动删除；如需清理，走 admin 用户管理或数据库运维流程。
- 渠道可停用：admin `/support-channels` 或上面的 toggle API。
- 不要删除正在被 runner 使用的 `accounts.json`；先停 runner。

## 故障排查

| 现象                                     | 原因 / 处理                                                                                                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `HTTP 403 CSRF token missing`            | 后端 CSRF 中间件若注册在 `cookieParser()` 之前，cookie 永远读不到。模拟器已按正规流程从 `GET /api/health` 获取 cookie + header；若仍 403，需要后端调整中间件顺序，或把 `/v1/otp` 加入 CSRF 跳过列表。**不要绕过 CSRF。** |
| `HTTP 429`                               | OTP/登录限流。脚本会按 `Retry-After` 自动重试；仍失败时等待 60 秒后重跑（已建账号会自动保留）。                                                                                                                          |
| `HTTP 404` + `support channel not found` | 渠道不存在或未启用；先创建/启用渠道。                                                                                                                                                                                    |
| `HTTP 501 SMS provider not configured`   | 生产未开启固定 OTP；配置 `OTP_PROVIDER=fixed` + `OTP_ALLOW_FIXED_IN_PROD=true`。                                                                                                                                         |
| `账号 token 无效或已过期（401）`         | 先调用 `refreshAccountToken()` 用 refreshToken 刷新；refreshToken 也失效时删除 `.runtime/accounts.json` 或用 `--replace` 重新建号。                                                                                      |
| 文件权限不是 600                         | 重新执行 provisioning 会自动 `chmod 600`；不要手动放宽权限。                                                                                                                                                             |

## 安全约束（必须遵守）

- token、完整手机号**不写日志**；错误信息统一脱敏
- `accounts.json` 只落本地、权限 600、已 gitignore
- 不调用 `/confirm`、`/confirm/otp`，不创建支付/订单/提现记录
- 不把模拟流量发到 `simulation_support_v1` 以外的渠道
- 并发上限 5；账号池默认 30

## 测试

```bash
node --test tools/simulator/*.test.mjs
```

测试全部使用 mock 网络，不会访问生产 API。
