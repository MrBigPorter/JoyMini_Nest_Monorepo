# Tasks

## 1. 共享判定与配置

- [x] 1.1 在 `graph/nodes/orchestrator-utils/knowledge-fallback.ts` 扩展 `INFORMATIONAL` 为 `isInformationalQuestion()`（保留现有中文标记，补「哪些 / 什么材料 / 需要什么 / 要准备」，补英文 how / what / where / when / can I / do I need / policy / rules / require / how long），并让 `turn-failure.ts` 与编排收尾统一从该文件导入。验证：`knowledge-fallback.spec.ts` 覆盖中英各 4 条正例与 2 条反例，`turn-failure.spec.ts` 现有断言全绿。
- [x] 1.2 新增 `AI_GROUNDING_GATE`（`off|shadow|enforce`，默认 `shadow`）的读取与校验，非法值回落 `shadow` 并告警。验证：单元测试覆盖三态与非法值；`yarn workspace @lucky/api tsc --noEmit` 通过。

## 2. 强制检索与并行预取

- [x] 2.1 在 `orchestrator.node.ts` 的流水线循环前，对「业务域或 `rag` 意图 + 信息类问句 + 本轮尚无知识库 sources」启动检索预取（与 Agent 并行）；检索异常记录 `retrievalSkippedReason` 后继续。验证：`orchestrator.node.spec.ts` 新增预取触发、非信息类不触发、检索抛错不阻塞三条用例。
- [x] 2.2 在收尾知识兜底处改为「命中即追加 `rag` 输出参与合成」，替换现有整段覆盖；仅当问句信息类、意图为业务域或 `rag`、且尚无 sources 时触发；`pendingConfirm` 存在时 MUST NOT 触发。验证：新增用例断言工具输出与 rag 输出同时进入合成输入；确认卡场景不触发检索。
- [x] 2.3 信息类问题未检索时写入跳过原因（非信息类 / 通用对话 / 服务不可用 / 待确认动作），并进入 trace 记录。验证：单测断言四种原因各自可读，且与「检索了但 0 候选」可区分。

## 3. 双语检索

- [x] 3.1 扩展 `RagRetrievalService` 的 `RetrievalOptions` 支持 `queryVariants`：四层召回对 `[原问句, ...variants]` 分别执行，层内按 chunkId 去重保留高分，此后沿用现有 RRF + rerank。验证：`rag-retrieval.service.spec.ts` 覆盖「变体命中、原问句不命中」与「同 chunk 两问句命中只保留一条」。
- [x] 3.2 新增 `QueryRewriteService`（`knowledge/query-rewrite.service.ts`）：仅对含 CJK 的问句调用现有 chat 模型改写为英文短查询，temperature 0、3 秒超时，结果按规范化问句哈希缓存 Redis 7 天（前缀 `rag:rewrite:*`）；失败返回 null 并标记 `rewrite=failed`。验证：单测覆盖「含 CJK 才改写」「超时回退 null」「缓存命中不再调用模型」「纯英文不改写」。
- [x] 3.3 在 `handleRagQuery` 与强制检索入口接入改写：改写成功时以 `queryVariants` 传入，失败时只用原问句。验证：`direct-handlers.spec.ts` 断言两种路径下检索调用参数正确，且用户可见回答不因改写失败而变化。

## 4. 依据分型与发布门禁

- [x] 4.1 新增 `graph/nodes/orchestrator-utils/grounding-gate.ts`：`classifyGrounding`（`fallback > tool > kb > none`，兜底话术与 `ai-failure-handler.ts` 同源）、`isClarificationOnly`、`decideGroundingGate`。验证：单测覆盖四类分型、工具失败不算依据、澄清回复放行、业务意图 `none` 降级；并断言分型取值与顺序与 `tools/eval/e2e/judge.mjs` 的 `classifyGrounding` 一致（同一组输入）。
- [x] 4.2 在 `ai-customer.service.ts` 写 trace 处补充 `metadata.grounding` 与 `metadata.toolCallCount`，`canned` 用未脱敏原文比对。验证：`ai-customer.service.spec.ts` 断言 kb / tool / none / fallback 四种 trace metadata 正确，且 `canned` 回复记为 `fallback`。
- [x] 4.3 在最终回复发布点接入门禁：`off` 不改行为；`shadow` 只记录 `groundingGateDecision`；`enforce` 对 `degrade` 走 `routeTransfer`，使用新增 `NO_EVIDENCE_HANDOFF_REPLY` 并记 `transfer{reason:'no_evidence'}`。验证：三个模式各一条集成式单测；`enforce` 下纯澄清与寒暄不被降级；降级时用户收到的文本不含金额/时效/规则断言。
- [x] 4.4 在 `grounding-gate.ts` 顶部注释写明三态开关语义、shadow 到 enforce 的切换条件与回滚方法，并核对与 `design.md` D4/D6 一致。

## 5. 评测口径与文档

- [x] 5.1 让 `tools/eval/e2e` 优先读取 `ai_traces.metadata.grounding`，缺失时回退到现有 `ai_traces`+`ai_spans` 推断，并在报告中标注数据来源。验证：`tools/eval/e2e/traces.test.mjs` 覆盖「metadata 存在」「metadata 缺失回退」两条；`node --test tools/eval/e2e/*.test.mjs` 全绿。
- [x] 5.2 更新 `tools/eval/e2e/README.md`：新增依据分型来源说明、`AI_GROUNDING_GATE` 对验收的影响（shadow 结果不得当作 enforce 结果）、以及无依据作答率的口径。验证：README 中的命令可照抄执行（本地 `node --test` 与 `rejudge` 命令）。

## 6. 集成验收

- [x] 6.1 shadow 模式跑一轮全量 `node tools/eval/e2e/run.mjs`，导出 `groundingGateDecision` 与实际回复的对照清单，逐条确认误降级可接受。验证：产出新报告目录，并在报告中列出 shadow 决定分布与人工复核结论。
- [ ] 6.2 切 `AI_GROUNDING_GATE=enforce` 再跑一轮全量验收。验证：无依据作答数相对基线 26 下降；kb 组准确率不低于 71/83 = 85.5%；真实回答率、语言一致率、时延 p95 的每项变化都有逐条归因；未达标的项不得登记为新基线。
  - 2026-11-24 已跑一轮（`reports/20261124-102433/`，240 例全完成）：kb 准确率 77/87 = 88.5% ✓、真实回答率与语言一致率已逐条归因 ✓；**未达标三项**：知识类 none 仍 26 条（拆分后事实性无依据 12 → 1，唯一漏网为菲律宾语回复 `multi:rz49+rz50`）、p95 9667 → 11543ms（+19.4%，超 15% 预算）、业务动作 7/7 → 5/7（`create_address`/`update_address` 被门禁降级中断）。结论与归因见该目录 `findings.md` §3/§4/§6；处理方案待定，不登记新基线。
  - 2026-11-24 修复后第二轮（`reports/20261124-113254/`，完成 235 / 配额跳过 5）：**事实性无依据（knowledge+multi）11 → 0** ✓、p95 +11.7%（预算内）✓、create/update address 恢复 ✓、真实回答率与语言一致率已逐条归因 ✓；**kb 准确率 75/89 = 84.3%，仍低于 85.5%（差 1 条）**，14 条不一致中内容不符 0 条（脱敏伪差异 5 + golden 文档集不全 9）。业务动作 5/6：`delete_address` 因模型把 userId 当 addressId、后端 P2025 未转业务错误返回 500 而失败（与门禁无关），`action:withdraw` 因配额跳过。结论见该目录 `findings.md` §2–§5；**6.2 仍未全部达标，不勾选、不登记新基线**。
  - 2026-11-24 测量复核（`reports/20261124-113254-rejudged/`，`rejudge.mjs --include-cited`）：严格口径重判 76/89 = 85.4%（同一批回答，判官 ±1 条波动）；放宽到「golden + 回答实际引用的文档」38/40 = 95.0%，15 条严格失败中 12 条翻为一致，剩余 3 条真问题（`knowledge:r79`、`knowledge:r103`、`knowledge:rz28`，均为细节添油加醋）。放宽口径只做诊断，不替代验收口径；是否修改 golden 集或验收分母需单独决定。
  - 2026-11-24 delete_address 修复（真实接口复核通过，非单测）：`AddressService.delete` 改 `deleteMany + count`（where 带 userId），`update` 补 `await`；P2025 按 `error.code` 判定（`instanceof` 跨 runtime 恒假，是 500 根因）；确认卡生成前校验 addressId 归属，失败以 ToolMessage 回给模型重试（fail-closed）；prompt 删除「必须传 userId 参数」。账号实测：bogus addressId → 400 `Address not found`，create→delete→再删 → 201/200/400，无残留。剩余：下一次全量跑确认 `delete_address` 用例 7/7。
  - 2026-11-24 兜底话术本地化：四种兜底（ai_failure/offline_handoff/quota_exceeded/no_evidence）按问句语言中英切换，判语言前剔除 id/URL token（真实轮次发现「中文问句夹带地址 id」会被判 mixed 回英文）；`isCannedReply` 与 `judge.mjs` 同步识别双语，否则英文降级会被计成无依据作答。已知运维坑：`lucky-backend-dev` 的 watch 在 bind mount 上不触发重编，真实接口复核前必须 `docker restart`。
  - 2026-11-24 v2 口径重判（`reports/20261124-113254-rejudged-v2/`，`ai-eval-loop` 7.1–7.2）：kbAccuracy 表面 78/89 = 87.6% ✓，但 10 条分层抽检只有 7/10 与人工一致，3 条翻真（`knowledge:r63`、`knowledge:r79`、`knowledge:rz28`）均不成立——判官把无来源的闪购细节与「权利可通过 Account → Privacy Settings 管理」的错误归属判成支持。按抽检修正后 **75/89 = 84.3%**，仍低于 85.5%。结论：**6.2 继续不勾选、不登记新基线**；先收紧判官提示词再重判复核。证据：`reports/20261124-113254-rejudged-v2/manual-review.md`、`summary.md` §判官理由抽检。
  - 2026-11-24 **复核更正**（同上目录 `manual-review.md` 末尾）：上一条把 `r63` 判成「闪购细节无来源」有误——`promotion-rules.en.md:84-87` 逐句有，且该文档由回答引用、本轮真实检索到；同理 `r20/r40/r43/r76/r77/r103` 等的依据在 `return-shipping-faq`/`product-authenticity`/`account-troubleshooting`/`contact-support`，判官只看 golden 所以看不到。按「判官是否判对」重算，v2 抽检一致率应为 8/10（仅 `r79`/`rz28` 过宽），v2 修正值应为 **76/89 = 85.4%**，不是 84.3%。
  - 2026-11-24 strict-v1 判官复核（`reports/20261124-113254-rejudged-v2-strict/`）：kbAccuracy 72/89 = 80.9%（另一次同配置 73/89），judgeErrorRate 0/302；19 条 false 逐条核对后 **15 条是误判**（依据在回答实际引用、golden 未列的文档里），4 条判得对。`--include-cited` 放宽后（`...-strict-cited/`）合成口径 85/89 = 95.5%，剩余不一致只有 `r79`/`rz28` 真正成立（`rz08`/`rz25` 为过严）。另一批 `005755` 同口径：严格 69/83 = 83.1%、合成 79/83 = 95.2%（真错误 `r14`/`r16`/`rz21`）。另外发现同一 `judgeInputHash` 两次运行有 2/97 判决漂移（`rz23`、`multi:r33+r34`），89 条样本的 95% CI ≈ ±7pp——**单次运行的 1 条差异不足以决定 6.2**。
  - 结论（更新）：**6.2 仍不勾选、不登记基线**；阻塞项从「判官过宽」更正为「判官输入范围（golden-only）+ golden 集不全 + 判官判决漂移」。下一步需立项决定准确性口径（golden∪cited，`METRIC_SPEC_VERSION` → 3）与重复判定/稳定性门槛，再谈 85.5% 验收线。
- [x] 6.3 对同一批用例做新旧对照：按依据分型分别给出条数与准确率，说明提升来自「更多问题进入 kb 组」还是「kb 组本身变准」。验证：报告含分型对照表，且结论与 `reports/20261124-005755-rejudged/summary.md` 口径一致。

## Workflow follow-up

- 归档前确认 `openspec validate ai-answer-grounding --strict` 通过。
- 验收报告与基线更新后，按项目流程归档本变更。
