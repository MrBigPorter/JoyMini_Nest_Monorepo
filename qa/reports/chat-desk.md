# QA Report — Chat Desk (Polling Merge / Scroll / Claim)

> 冻结提交 `d7bdced2`（chat-desk `e730b4a8`）；复验提交 `09a28081`（D-CD-01 修复）
> 结论：**PASS**（首轮 4/5，D-CD-01；复验 **5/5**，滚动用例连续重复 2 次均通过）

## 1. 测试对象

| 项 | 值 |
|---|---|
| 冻结提交 | `d7bdced2`（chat-desk/insights `e730b4a8`） |
| 复验提交 | `09a28081`（父 `d7bdced2`，仅 `ChatWindow.tsx`：在真实滚动容器 `<main>` 上跟踪 near-bottom） |
| 范围 | 10s 轮询合并保留已加载历史；上滚不被轮询强制到底；claim 失败提示；`awaiting_human` 点 Human 走认领而非切回 AI |
| 产品代码改动 | 无（QA 只新增 `qa/seed/chat-desk.ts`、`apps/admin-next/e2e-qa/chat-desk.spec.ts`） |

## 2. 环境与命令

真实 admin（4101）+ 真实 API（4102）+ 真实 QA Postgres（5433/`joy_mini_qa`），无 API mock。

```bash
# 种子（测试 beforeAll/afterAll 自动执行；也可手动）
set -a; . qa/.env.qa; set +a
npx tsx qa/seed/chat-desk.ts

cd /Volumes/MySSD/work/JoyMini_Nest_Monorepo/apps/admin-next
QA_ADMIN_URL=http://127.0.0.1:4101 QA_API_URL=http://127.0.0.1:4102/api \
  ../../node_modules/.bin/playwright test --config=playwright.qa.config.ts \
  e2e-qa/chat-desk.spec.ts
```

日志：`qa/logs/chat-desk-playwright.log`（首轮）、`qa/logs/chat-desk-playwright-reverify.log`（复验）。

种子会话（均 `SUPPORT/status=1`）：

- `qa_cd_conv_merge`：40 条消息，首屏只取 30 条（seq 11–40），`handlerId=null`；
- `qa_cd_conv_claim`：`awaiting_human`；
- `qa_cd_conv_conflict`：`awaiting_human`，点击前由测试把 handler 改成 `qa_admin_admin` 制造 409；
- `qa_cd_conv_human`：`awaiting_human`，用于验证 Human 按钮路径。

## 3. 结果

| # | 用例 | 首轮 `d7bdced2` | 复验 `09a28081` |
|---|---|---|---|
| 1 | 轮询合并保留已加载历史 | PASS | **PASS** |
| 2 | 上滚时轮询不强制到底 | FAIL（D-CD-01） | **PASS** |
| 3 | claim 成功归属当前客服 | PASS | **PASS** |
| 4 | claim 409 显示错误提示 | PASS | **PASS** |
| 5 | `awaiting_human` 点 Human 走认领、不 PATCH `/handler` | PASS | **PASS** |
| | **合计** | **4/5** | **5 passed / 5** |

复验命令：

```bash
cd /Volumes/MySSD/work/JoyMini_Nest_Monorepo/apps/admin-next
QA_ADMIN_URL=http://127.0.0.1:4101 QA_API_URL=http://127.0.0.1:4102/api \
  ../../node_modules/.bin/playwright test --config=playwright.qa.config.ts \
  e2e-qa/chat-desk.spec.ts
# 滚动用例稳定性：--repeat-each=2，2/2 passed
```

### 3.1 PASS 证据

1. **轮询合并**：先加载首屏（seq 11–40），确认 `qa_cd_merge_msg_01` 不在 DOM；点「加载更早的消息」拉入 seq 1–10；等待 11.5s（至少一次 10s 轮询）后，`msg_01` 仍在、`msg_40` 仍在。说明轮询走 `mergeChatMessages`，没有用最新 30 条整段替换。
2. **claim 成功**：`POST /chat/conversations/qa_cd_conv_claim/claim` 返回 200，`handlerId=qa_admin_admin`；认领按钮随后消失。
3. **claim 409**：先把 `qa_cd_conv_conflict.handlerId` 改为 `qa_admin_admin`，再点「认领」；响应 409，页面出现 toast「会话已被其他客服认领，列表已刷新」。
4. **Human 按钮**：`qa_cd_conv_human` 为 `awaiting_human` 时点 `👤 Human`，实际发出 `POST .../claim` 并 200（`handlerId=qa_admin_admin`）；请求记录中 `PATCH .../handler` 数量为 0。

### 3.2 D-CD-01 复验（FIXED in `09a28081`）

首轮复现步骤：打开 `qa_cd_conv_merge` → 加载更早消息 → 把真实滚动容器滚到顶部 → 等待 11.5s（一次轮询）。

```text
首轮 before: scrollTop=0, distanceFromBottom>100
首轮 after : scrollTop=3254（已到页面底部）   # D-CD-01
```

首轮 DOM 实测：

```text
div "flex-1 overflow-y-auto px-5 py-4 ..."  clientHeight=3620  scrollHeight=3620   # ChatWindow 消息区：不可滚动
main "flex-1 overflow-auto p-4 lg:p-6 ..."   <- 实际滚动容器（页面整体）
```

修复后（`09a28081`）同一用例：`main.scrollTop` 保持 0（<50），`distanceFromBottom` 仍 >100；轮询只合并数据，不再滚动页面。滚动用例以 `--repeat-each=2` 连续复跑 2/2 通过，不是偶发绿。

修复方式（只读复核）：`ChatWindow` 通过 `messagesScrollRef.closest('main')` 找到真实滚动容器，在其上监听 `scroll` 维护 `nearBottomRef`，轮询回底时调用该容器的 `scrollTo`；内层不可滚动 div 不再承担 near-bottom 判定。

## 4. 缺陷

### D-CD-01 — 上滚后 10s 轮询仍把客服甩回底部（P2）— **FIXED**

| 项 | 内容 |
|---|---|
| 严重度 | P2（阅读体验；首轮该项验收失败） |
| 状态 | **FIXED**，提交 `09a28081`；复验 5/5，滚动用例 repeat 2/2 |
| 位置（首轮） | `apps/admin-next/src/components/customer-service/ChatWindow.tsx:55,130-131,346-350`；`apps/admin-next/src/components/layout/MainContent.tsx:13`；`apps/admin-next/src/components/customer-service/CustomerServiceDesk.tsx:217,224,275` |
| 首轮问题 | `nearBottomRef` 只监听 ChatWindow 内部消息区；该元素 `scrollHeight == clientHeight`（不滚动），ref 恒为 `true`。真正滚动的是 `<main overflow-auto>`，轮询触发 `scrollIntoView` 把页面拉到底 |
| 修复 | 在 `messagesScrollRef.closest('main')` 上监听 scroll 维护 near-bottom，并用该容器 `scrollTo` 回底 |
| 复验 | `main.scrollTop` 轮询后保持 0（首轮 3254）；其余 4 项仍 PASS |

## 5. 回归

| 套件 | 结果 |
|---|---|
| Batch 1 权限 | 24/24 |
| Batch 2 triage | 18/18 |
| Batch 4 eval | 9/9 |
| Batch 5 analysis | 9/9 |

日志：`qa/logs/regression-batch1.log`、`regression-batch2.log`、`regression-batch4.log`、`regression-batch5.log`。

## 6. 残留 / 未覆盖

- 轮询间隔按组件 10s 真实等待，未覆盖网络慢/请求失败时合并回退。
- 未注入 WebSocket 新消息与轮询同时到达的竞态（`registerOnNewMessageAction` 路径）。
- claim 失败只覆盖 409；未覆盖 404/网络错误文案。
- 测试通过直接改 DB 制造 409，未并发启动第二个客服客户端。
