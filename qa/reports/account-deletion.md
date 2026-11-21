# QA Report — Account Deletion Cascade & Privacy Disclosure

> 冻结提交 `d7bdced2`（账号删除级联 `d7bdced2`、隐私文案同提交）
> 结论：**PASS**（API/service 2/2；隐私六语言 6/6；无迁移文件）

## 1. 测试对象

| 项 | 值 |
|---|---|
| 仓库 | `/Volumes/MySSD/work/JoyMini_Nest_Monorepo` |
| 分支 | `feat/ai-ops-operator-console` |
| 冻结提交 | `d7bdced2`（HEAD） |
| 范围 | `AuthService.clearUserData` AI 数据级联；共享会话保留；资金/KYC 保留；六语言隐私文案 |
| 产品代码改动 | 无（QA 只新增 `apps/api/test/ai-ops/account-deletion.e2e-spec.ts`、`qa/**`） |
| 迁移审核 | 本提交 `git show --stat d7bdced2` 无 `apps/api/prisma/migrations/**`，无破坏性语句 |

## 2. 环境与命令

QA 隔离环境：Postgres `127.0.0.1:5433/joy_mini_qa`、Redis DB 15、API `4102`。测试直接实例化真实 `AuthService` + `PrismaService`，强制先加载 `qa/.env.qa`，不触碰 dev 库 `joy_mini` 与 Redis DB 0。

```bash
docker start lucky-db-qa lucky-redis-qa
cd /Volumes/MySSD/work/JoyMini_Nest_Monorepo/apps/api
../../node_modules/.bin/jest --config ./test/jest-e2e.json --runInBand --forceExit \
  test/ai-ops/account-deletion.e2e-spec.ts
```

日志：`qa/logs/account-deletion-api.log`

## 3. 结果

| 套件 | 结果 |
|---|---|
| Account deletion cascade（service-level） | **1 passed / 0 failed** |
| Privacy policy content（6 languages） | **1 passed / 0 failed** |
| 合计 | **2 passed / 2 total** |

### 3.1 级联删除断言

Seeded `qa_del_*`：用户 A（`qa_del_user`）+ 用户 B（`qa_del_other`）、钱包、KYC、treasure、订单、独占会话、共享会话（A/B 各有消息）、trace + span、LLM/HUMAN score、用户级/会话级 feedback、memory、summary。调用 `auth.clearUserData('qa_del_user')` 后：

| 断言 | 期望 | 实际 | 结果 |
|---|---|---|---|
| 用户软删 | `status=0` | 0 | PASS |
| 自己的 trace / span | 删除（span 随 trace 级联） | `null` / `null` | PASS |
| LLM score / HUMAN score | 删除 | `null` / `null` | PASS |
| 本人 feedback / 会话级 feedback | 删除 | `null` / `null` | PASS |
| 本人消息（独占 + 共享中本人） | 删除 | `null` / `null` | PASS |
| 本人 membership | 删除 | `findFirst` = null | PASS |
| 独占空会话 | 删除 | `null` | PASS |
| 共享会话 | 保留 | 存在 | PASS |
| 共享会话中用户 B 的消息/成员 | 原样保留 | 存在 | PASS |
| 用户 B | 不受影响 | `status=1` | PASS |
| 钱包 / KYC / 订单 | 保留（不因注销清空） | 全部存在；KYC `kycStatus=4`、`idNumber` 原值；订单存在 | PASS |

> 说明：`clearUserData` 使用 Prisma `$transaction`；测试是 service-level，覆盖真实事务与 FK 级联，不经过 HTTP controller。

### 3.2 隐私文案六语言

从 `apps/frontend-blog/src/lib/privacy/privacy-content.ts` 解析 `en/zh/ja/ko/fr/de` 六个模板块，逐块断言：

- 披露 `DeepSeek`、`Jina AI`、`Groq`；
- 说明 trace（`trace|Trace|トレース|추적`）保留 `30` 天；
- 说明删除账号会删除 AI 数据（`delete|删除|削除|삭제|supprim|lösch`）；
- 不含过度承诺：`signed DPA` / `已签 DPA` / `签署 DPA` 均为 0 命中。

结果：六语言全部 PASS。

## 4. 缺陷

**无。** 本组验收未发现产品缺陷。

## 5. 残留 / 未覆盖

1. **HTTP 入口未覆盖**：本测试直接调用 service；未验证账号注销 controller 的鉴权、幂等与响应包裹。当前验收只要求 `clearUserData` 级联。
2. **级联范围边界**：只验证 AI 数据、消息、成员、记忆、摘要、独占会话与资金/KYC；未枚举用户表的其他业务数据（地址、优惠券、设备等）。
3. **共享会话中的 AI trace**：trace 按 `userId` 删除；若共享会话中他人触发的 trace 带有被删用户 id，未单独构造该组合。
4. **隐私文案**：只做静态内容断言，未启动 blog 前端逐语言渲染。
