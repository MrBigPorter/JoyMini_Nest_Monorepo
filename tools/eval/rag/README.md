# RAG 检索离线评测

## 是什么

用固定黄金集测「问题 → 正确知识文档」的检索质量，指标：

- **Hit@1 / Hit@3**：正确文档是否出现在前 1 / 前 3 条
- **MRR**：正确文档首次出现的排名倒数均值
- **p50 / p95**：检索延迟

同时输出按域（order / wallet / coupon / ...）的细分，以及可选的 `domain` 过滤结果。

## 怎么跑

前置：`lucky-backend-dev`、`lucky-db`、`lucky-redis`、`lucky-nginx-dev` 在运行，且知识库有数据。

```bash
# 推荐：自动在容器内签 ADMIN token，再调 HTTP 接口
tools/eval/rag/run-replay.sh

# 自定义
tools/eval/rag/run-replay.sh --topk 5 --delay 1.1 --limit 10

# 手动传 token
EVAL_TOKEN=<admin-jwt> python3 tools/eval/rag/run.py
```

> 全局限流是 60 次/分钟。默认每道题会请求两次（全局 + domain 过滤），
> 40 题约 80 次请求，建议 `--delay 1.1`，否则可能触发 60s 冷却。

## 黄金集

`golden.jsonl`，一行一题：

```json
{"id":"r01","query":"退款多久到账？","expectedDocIds":["refund-policy"],"domain":"order"}
```

- `expectedDocIds` 用知识库的 `doc_id`（不是数据库 cuid）
- 当前 40 题覆盖 8 个域、中英文混合
- 知识库文档变更后，记得同步维护黄金集

## 结果存档

`reports/<timestamp>.json`：包含汇总、按域指标和逐题明细（retrievedDocIds / rank / latency）。

## 2026-11-19 基线

| 指标 | 全局 | domain 过滤 |
|---|---:|---:|
| Hit@1 | 82.5% | 92.5% |
| Hit@3 | 97.5% | 97.5% |
| MRR | 0.898 | 0.956 |
| p50 | 751ms | 711ms |
| p95 | 858ms | 777ms |

唯一未进前 3 的题：`r16 订单一直没发货怎么办？`（rank=4，期望 `order-troubleshooting`）。
