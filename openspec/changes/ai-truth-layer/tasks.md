# Tasks

## 1. 登记与解析

- [x] 1.1 [Req: 事实必须有唯一权威来源] 建 `tools/truth/registry.json`：入金与提现各渠道 × 安全上限/下限/费率形式/是否支持，每项含 `key / source / expectForm / parser`；为时效登记一条 `unsourced` 条目。验证：单测断言每个键四个字段齐全，且 `unsourced` 条目带 reason
- [x] 1.2 [Req: 事实必须有唯一权威来源] 实现文档扫描与行内标记解析（`<!-- truth: <key> -->`）。验证：单测覆盖正常行、缺标记、一行多标记、列数不符、标记指向未登记键，五种情况各有断言
- [x] 1.3 [Req: 文档声明必须与真值源一致] 实现单元格取值解析，按登记形式产出结构化值（`flat` / `rate_plus_fixed` / `amount`）。验证：单测覆盖 `₱1,000`、`Free`、`0.8%`、`0.8% + ₱5`、`2.5% fee`、非法文本，逐种断言解析结果或报错

## 2. 取值与比对

- [x] 2.1 [Req: 文档声明必须与真值源一致] 实现 HTTP 来源适配器，按登记读取渠道配置与文档正文，只发 GET、带管理员鉴权。验证：对本地 stub 服务单测 200 / 404 / 超时 / 结构不符四种响应
- [x] 2.2 [Req: 文档声明必须与真值源一致] 实现比对器：文档值 vs 真值，输出 `docId / 事实类型 / 文档声明 / 真值 / 结论`。验证：单测用 fixture 断言值不一致、形式不一致、渠道不存在三类均判失败并带全字段明细；全部一致时判通过
- [x] 2.3 [Req: 校验不可静默跳过] 实现失败语义：来源不可达、登记不可解析、单元格不可解析、零条比对，四种均返回失败并给出可读原因。验证：单测逐种断言退出状态为失败且原因非空
- [x] 2.4 [Req: 校验不可静默跳过] 实现 CLI 入口 `node tools/truth/check.mjs`（参数：base url、令牌、可选 doc 范围），失败退出码 1、成功 0。验证：对 fixture 服务跑一次失败用例与一次通过用例，断言退出码与逐条输出

## 3. 修正现存文档

- [x] 3.1 [Req: 文档声明必须与真值源一致] 在 dev 环境给 `deposit-guide` / `withdrawal-guide` 的渠道表格行补标记，修正与 `payment_channels` 冲突的数值，时效改为定性表述。验证：对 dev 环境跑 `check.mjs`，输出 0 条冲突（实测 20/20 通过、exit 0；写回各产生新版本 v3 / v4。过程中发现管理端把 `fee_rate` 截成 2 位小数导致 0.8% 读成 1%，已按 D11 修正）
- [x] 3.2 [Req: 事实必须有唯一权威来源] 确认文档改动产生了新版本，并演练单篇回滚后校验再次变红、切回后转绿。验证：`KbVersionService` 回滚前后各跑一次 `check.mjs`，两次结论符合预期（实测：`withdrawal-guide` v4→v3 回滚后 exit 1，阻断写明「正文 v4 / 检索服务 v3」；切回 v4 后 20/20 通过）

## 4. CI 接入

- [ ] 4.1 [Req: 校验不可静默跳过] 新增 workflow：`schedule` 每日、`workflow_dispatch` 手动、`pull_request` 限定路径（payment-channel 模块、prisma/migrations、tools/truth）。验证：workflow 文件通过 `actionlint`（或 push 到分支后 GitHub 解析无错），且失败时 job 为 failure
- [ ] 4.2 [Req: 校验不可静默跳过] 用 `workflow_dispatch` 对部署环境跑一次。验证：Actions 中该 run 为绿，日志列出每条声明与比对条数

## 5. 验收演练

- [ ] 5.1 [Req: 文档声明必须与真值源一致] 在 dev 环境把一个费率改掉、不动文档，触发校验。验证：校验变红并指出该条差异；费率改回后变绿
- [x] 5.2 [Req: 校验不可静默跳过] 用错误的 base url 触发校验。验证：失败，报告写明不可达的来源与失败原因，且不出现「跳过」字样（实测：`http://127.0.0.1:59999` → exit 1，阻断写明 `GET /admin/payment/channels/list… fetch failed（ECONNREFUSED）`，输出无「跳过」）

## Workflow follow-up

- 全部任务完成并验收通过后，归档变更：`openspec archive ai-truth-layer`
- 归档后确认 `openspec/specs/ai-quality/truth-source/spec.md` 已生成
