# Overnight Run — 2026-11-21

> 状态：Batch 1–5 全部 PASS；用户已恢复交互，可继续两周项或收尾。
> 依据：`docs/AI-joymini/118`、`119`、`120`。

## 当前状态

- 最后提交：`b7f54227`（Batch 5 QA PASS）
- 工作区：clean
- QA 环境：仍运行（API 4102 / Admin 4101 / DB 5433 / Redis 6382）
- 停止命令：`bash qa/scripts/run-batch1.sh --stop`

## 批次进度

| 批次 | 状态 | 关键提交 | QA |
|---|---|---|---|
| Batch 1 权限 + 下钻 | **PASS** | `de578ca5`…`09fd7072` | 24 API + 9 UI + D-03/D-04 |
| Batch 2 分诊语义 + 今日 | **PASS** | `0f5f8b8b`、`db52a60a`、`2347f3a5` | 18 API + 9 UI |
| Batch 3 开关 + 血缘 | **PASS** | `56879855`、`07245b1b`、`a86e96fb` | 13 API + 2 UI |
| Batch 4 回归期望 + 生命周期 | **PASS** | `f6e39769`、`c08df55c`、`2561806f` | 9 API + 3 UI |
| Batch 5 119 Phase 1 | **PASS** | `4be75eaf`、`7aaeda85`、`0bcdcc80` | 9 API + 2 UI |
| Quick Wins 1：SLA 分钟唯一 + 知识评分 | **PASS** | `e4eff5ab`、`0f6518d5` | 4 API + 1 UI + 回归 9/8 |
| PII 治理 + eval 隐私（D-01） | **PASS** | `346fd403`、`3f780241`、`301cff59` | 7 API + 1 UI + 回归 42 |
| Insights 指标（P1-4） | **PASS** | `42ee6d76` | 3 API + 2 UI |

## 已交付能力

- VIEWER 不再读到原始用户文本；工程导航与首页入口对 VIEWER 隐藏。
- 质量页 URL 下钻、KPI 链接、待办/信号分轨、`NO_ISSUE`、今日窗口、日期筛选。
- trace `aiMessageId`、feedback `traceId`、security `conversationId` 已接通。
- 功能开关统一走 `/admin/ai-ops/features`；eval 写接口受门禁。
- 回归用例必须有期望答案；用例可编辑/删除；run 并发锁、孤儿回收、终态停轮询。
- 119 Phase 1：问题事件、指标窗口、分析运行、`/ai-ops/analysis` 页面。

## 剩余（未做）

- 118 §8.2 剩余：LIVE eval 作业化、注销级联与隐私政策披露、运营面补完（owner/状态机/批量/快捷键/知识动作）。运营核心指标与 PII trace 治理已完成。
- D-IM-01（P2）：转人工率 KPI 是会话总体（2/3），下钻仍是 `signal=transferred` 反馈信号（5 条）；待统一总体。
- D-02（P2）：EDITOR 工程导航与 traces 接口 403 不一致。
- 119 Phase 2–5：聚类、问题簇页、小时级告警、修复闭环、分区/保留。
- 已完成：SLA 分钟唯一、知识评分 truncation 误报、编辑重算。
- D-01：VIEWER 仍可读 eval 数据集/结果原文（Batch 4 未处理，需后续）。
- D-02：EDITOR 工程导航与接口 403 不一致。
- `AI_QUALITY_V2_ENABLED` 已从文档移除，代码中不存在。

## 早上/下次接续

1. 如需继续：先做 118 §8.2 的 SLA 分钟唯一 + 知识评分 truncation 修正（已准备好方案）。
2. 再做 119 Phase 2 聚类。
3. QA 环境可随时用 `bash qa/scripts/run-batch1.sh` 起；停止用 `--stop`。
