# Design

## Context

- 评测工具已存在：`tools/eval/replay.py`（458 行）打生产分类接口，golden 为 `{id, input, expect, tags, note}`，63 条。
- 任务成功率无法从现有数据得到：回放只打分类接口，拿不到 AI 回复与工具调用序列。
- 反馈：无任何采集。
- 管理端已有会话页与客服工作台。

## Goals / Non-Goals

**Goals:** 评测可信、比较可判定、线上问题可回流。

**Non-Goals:** 不做线上 A/B 分流；不评模型本身能力（只评应用链路）；不改 Flutter 端。

## Decisions

### D1. 150 题 + 配对检验，而不是把 CI 压到可分辨

150 题时 95% CI 约 ±7.4 个百分点，独立比较仍不灵敏。但两方案跑同一批样本，用 McNemar 只看不一致的题，灵敏度高得多（约 20 道不一致中 15:5 即可显著）。

**替代方案**：扩到 900 题把 CI 压到 ±3 个点——人工标注成本远超收益，否决。

### D2. Judge 用不同厂商模型，仅周级调用

选另一个厂商的便宜 API，月成本在几元量级。理由：同厂商模型存在同语料同偏好，自评分数系统性偏高。

**替代方案**：本地 Ollama——4GB 内存放不下且项目已明确不需要本地 LLM。

### D3. 评测用 fixture 用户，写工具只判定卡片

预置订单/钱包/券/KYC 数据；只读工具真实执行；写工具不执行，只比对确认卡片内容是否符合预期。这样既不污染真实数据，又能覆盖任务链路。

### D4. 反馈分显式与隐式两类，同表不同来源

落表 `ai_answer_feedback`（迁移 `20261119150000_add_ai_answer_feedback`）：

| 字段 | 说明 |
|---|---|
| `conversation_id` / `message_id` / `user_id` | 关联会话与被评价消息 |
| `source` | `explicit` / `implicit` |
| `verdict` / `error_type` | 显式：`correct` / `incorrect` + `irrelevant` / `outdated` / `overreach` / `format` |
| `signal` | 隐式：`transferred` / `repeated_question` / `abandoned` |
| `note` / `admin_id` | 标注备注与标注人 |
| `metadata` | 结构化线索（如转人工 reason、相似度），不存用户原文 |

写入路径：

- 显式：`POST /admin/ai-feedback`（ADMIN/SUPER_ADMIN），`GET /admin/ai-feedback` 支持 source/signal/errorType 筛选与分页。
- 隐式：转人工时写 `transferred`；同用户最近一条消息与当前内容 Jaccard ≥0.8 写 `repeated_question`；生成被取消写 `abandoned`。隐式信号 10 分钟窗口内同 signal 去重。

**为什么不把两类混为一谈**：客服标注是判断，隐式信号只是线索，导出时的可信度不同。

### D5. 评测集 schema 升级，保留旧字段

从 `{id, input, expect, tags, note}` 扩展到增加 `fixtures`、`expectTask`；旧字段不变，旧的 63 条可平滑迁移。

### D6. 管理端标注入口与导出契约

- 会话页消息气泡提供「正确 / 有误」入口；有误时必选四类错误之一，可填备注。
- 新增「待标注」列表：source/signal/errorType 筛选 + 分页；显式与隐式用不同来源标签展示。
- 入口受开关控制：`AI_FEEDBACK_UI_ENABLED`，默认关闭，验证通过后开启；关闭时页面不渲染入口且接口拒绝写入。
- 导出格式为 JSONL，字段与回放工具兼容：
  `{ id, input, expect, tags, note, source, errorType }`。
  `expect` 对隐式信号/未判定样本为空，导出后需人工补标才能进入回放；
  回放工具遇到空 `expect` 必须拒绝而不是当成 `general`。

**为什么导出不直接产出 golden**：隐式信号只说明“可能有问题”，

并不知道正确答案；把空 expect 当标签会让评测分数虚高。

## Risks / Trade-offs

- **[人工标注主观]** → 边界样本双人标注，分歧记为待裁决，不计入分母。
- **[judge 偏差]** → 抽检 10% 校准，一致率低于 80% 就调整。
- **[fixture 维护成本]** → 只覆盖评测需要的 4 类数据，不追求全量。
- **[隐式信号误报]**（用户正常追问也算重复） → 阈值保守，且与显式信号分表统计。

## Migration Plan

1. 评测集扩容 + 查重（不改线上）
2. schema 升级与回放兼容
3. judge 接入与人工校准
4. 反馈表与接口
5. 管理端标注入口与待标注列表

回滚：1~3 只影响评测工具；4~5 可通过开关关闭入口。

## Open Questions

- 错误类型的枚举取值需要与客服团队确认，先用「答非所问 / 信息过时 / 越权试探 / 格式错误」四类。
