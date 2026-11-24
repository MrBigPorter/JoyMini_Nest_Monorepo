# 发布清单（知识库与 AI 质量）

> 版本: v1.0
> 日期: 2026-11-24
> 适用: 后端发版、知识库变更后的回归、AI 质量基线登记
> 关联: `openspec/changes/kb-regression-gate`、`tools/eval/e2e/README.md`、`tools/eval/e2e/METRICS.md`

---

## 0. 一句话原则

**没有一次跑在「当前语料 + 待发代码」上的全量运行，就不发版。**

子集运行只能回答「这次知识库改动有没有把已有用例弄坏」，不能代替发版前的全量验证。

---

## 1. 什么情况下必须跑全量

满足任意一条，就必须在发布前跑一次全量：

- [ ] 知识库正文、分块或激活版本发生变化
- [ ] Prompt、意图路由、检索、embedding 模型或切片策略变化
- [ ] 判官版本、指标定义或 `METRIC_SPEC_VERSION` 变化
- [ ] 距上次有效全量已超过 7 天
- [ ] 即将发布到生产
- [ ] 即将登记新基线（`promote`）

**不需要**跑全量的情况：只改前端、只改日志、只改与 AI 回答链路无关的后端代码；此时仍需通过常规 CI 与部署门禁。

---

## 2. 知识库改动后的日常流程（子集）

适用于运营在 admin 上传并激活文档之后。

1. 打开管理端 `AI 运营 → 质量 → 回归测试`，确认状态是「有变更」而不是「已覆盖」。
2. 记录卡片上的**语料指纹**、变更文档列表、受影响用例数。
3. 若有未覆盖的变更文档（没有对应用例），先决定：补用例，或记录「无需覆盖」的理由。
4. 复制页面给出的子集命令，或手动执行（`E2E_BASE_RUN_ID` 填卡片上的「上次全量」run id）：

   ```bash
   E2E_SCOPE=subset \
   E2E_DOC_IDS="<docId1>,<docId2>" \
   E2E_BASE_RUN_ID="<上次全量 run id>" \
   E2E_KINDS=knowledge,multi \
   node tools/eval/e2e/run.mjs
   ```

5. 运行结束（目标 ≤5 分钟）后，在控制台查看：
   - 子集结果落在独立的 `e2e:<指纹>` 数据集
   - 与上次全量的差异只作诊断，不当作基线
6. 若出现失败：先判断是文档内容问题、用例期望过期，还是模型问题；按质量待办流程处理。

> 子集运行不会自动登记基线，也不能用于 `promote`。

---

## 3. 发版前检查（全量）

### 3.1 确认语料与代码

- [ ] 记录**当前语料指纹**：

  ```bash
  curl -s -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    "${API_BASE_URL}/v1/admin/rag/documents/meta/corpus-fingerprint"
  ```

- [ ] 确认待发布代码的 `commitSha` 与 QA 环境 `/api/v1/health` 返回一致：

  ```bash
  curl -s "${API_BASE_URL}/v1/health"
  ```

- [ ] 确认 QA 语料与生产语料指纹一致；不一致时在发布记录里写明原因与影响范围：

  ```bash
  curl -s -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    "${QA_API_BASE_URL}/v1/admin/rag/documents/meta/corpus-fingerprint"
  curl -s -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    "${PROD_API_BASE_URL}/v1/admin/rag/documents/meta/corpus-fingerprint"
  ```

### 3.2 执行全量

```bash
node tools/eval/e2e/run.mjs
```

- [ ] 运行使用外部 harness 模式，`scope=full`。
- [ ] 运行开始前与结束后的语料指纹一致（`knowledgeSnapshot.stable = true`）。
- [ ] 没有待激活文档（`pendingActivation` 为空）。
- [ ] 实际执行用例数等于数据集用例数，没有大量跳过。
- [ ] 判官错误率低于 2%，`judgeAgreement` 不低于 95%。

### 3.3 核验证据

- [ ] 打开管理端 `AI 运营 → 质量 → 回归测试 → 选择评测集 → 最近运行 → 查看发布证据`，或直接请求接口：

  ```bash
  curl -s -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    "${API_BASE_URL}/v1/admin/ai-eval/runs/<runId>/evidence"
  ```

- [ ] 证据结论为「通过」，且列出的服务端版本等于待发布版本。
- [ ] 若任一校验不通过：按页面原因修复后重跑，不得手工改结论。

### 3.4 内容人工抽检

> 责任人：本次发版的测试 / 运营负责人。以下勾选项即发布单中的抽检记录，逐项填写样本位置或结论。

- [ ] 从本次运行的引用核验诊断中抽取 20% 样本，至少 3 条，人工确认回答与引用文档一致。样本位置：
- [ ] 对本次变更过、且 diff 超过阈值的文档，逐篇核对变更段落，确认符合业务事实。已核对文档：
- [ ] 抽检发现的问题：能补用例的补用例，属于文档错误的先回滚或修正文档，再重跑全量。

### 3.5 发布

- [ ] 部署单或提交信息中带上运行标识（`Eval-Run: <runId>`），或在手动部署时填写 `eval_run_id`。
  入口：GitHub `Actions → Deploy Backend → Run workflow`。
- [ ] 确认部署工作流的 `eval-evidence` job 通过；当前默认 `advisory`，不通过会告警但不阻断。
  门禁回退/升级开关：仓库变量 `EVAL_GATE_MODE`（`advisory` / `enforce`）。
- [ ] 若已切到 `enforce`，证据不通过时不得跳过门禁；确需紧急发布时由负责人书面记录并临时降级。

---

## 4. 证据判定速查

| 情况 | 结论 | 下一步 |
|---|---|---|
| 全量、稳定、指纹一致、指标达标 | 通过 | 可发布 |
| 运行中激活了新版本 | 不通过 | 等激活完成，重跑 |
| 指纹与当前不一致 | 不通过 | 确认是否有新变更，重跑 |
| 子集运行 | 不通过 | 只能作诊断，不能作发布证据 |
| 实际执行数少于数据集用例数 | 不通过 | 查看跳过原因并重跑 |
| 判官错误率 ≥2% 或 agreement <95% | 不通过 | 查判官鉴权、限流、超时与分歧用例 |
| 服务端版本与待发布版本不同 | 不通过 | 确认 QA 是否已部署同一 commit |

---

## 5. 回滚

- [ ] 知识库文档回滚：在保留期（7 天）内把上一激活版本重新激活。
- [ ] 代码回滚：`EVAL_GATE_MODE=advisory` 可立即降级门禁；不删除已写入的 run 与证据。
- [ ] 回滚后仍需跑一次全量，重新建立当前语料上的有效证据。

---

## 6. 明确不做

- 不把子集结果当基线，不用子集通过代替发版前全量。
- 不用「大量跳过后的高通过率」作为证据。
- 不手工修改证据结论，不跳过 `enforce` 门禁。
- 不把 GitHub 凭据放进生产 API 或前端环境变量。
