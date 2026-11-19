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

# rerank 贡献对比（同一批题跑 rerank=true / false）
tools/eval/rag/run-replay.sh --compare-rerank

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

### 检索主链路（rerank=true）

| 指标 | 全局 | domain 过滤 |
|---|---:|---:|
| Hit@1 | 85.0% | 92.5% |
| Hit@3 | 95.0% | 97.5% |
| MRR | 0.902 | 0.956 |
| p50 | 762ms | 745ms |
| p95 | 1179ms | 1031ms |

> 同一批题在更早一次运行中是 Hit@1 82.5% / Hit@3 97.5% / MRR 0.898；
> 单题（r40「Can I sell counterfeit goods?」）的召回波动会带来 ±2.5pp 的 Hit@3 差异。

### Rerank 贡献（同一次 `--compare-rerank` 运行）

| 指标 | rerank=true | rerank=false | 差值 |
|---|---:|---:|---:|
| Hit@1 | 85.0% | 77.5% | **+7.5pp** |
| Hit@3 | 95.0% | 97.5% | **-2.5pp** |
| MRR | 0.902 | 0.877 | **+0.025** |
| p50 | 762ms | 428ms | **+334ms** |
| p95 | 1179ms | 482ms | **+697ms** |

结论：reranker 明显提升 top-1 精度和 MRR，代价是延迟约 1.8 倍；
Hit@3 的 -2.5pp 来自单题波动，不应解读为系统性退化。

## Faithfulness proxy（引用/数字支持）

通过真实 `test-chat` 图路径拿 `answer + sources`：

```bash
tools/eval/rag/faithfulness.sh --limit 20
```

| 指标 | 结果 | 说明 |
|---|---:|---|
| RAG answers | 14/20（70%） | 其余题被分类到 general/coupon/order，未走 RAG |
| citation rate | 92.9% | 回答正文引用了来源标题/docId |
| numeric support | 70.0%（n=10） | 回答里的数字能全部在 sources 中找到 |
| expected source hit | 100% | 期望文档出现在 sources |
| p50 / p95 | 3760ms / 4477ms | 完整图路径 |

> **这是 proxy，不是 LLM-as-Judge**：数字支持率只能抓「编造数字」，
> 抓不到「语义歪曲」；citation rate 只证明引用了来源，不证明回答被来源支持。
> 下一步应补 LLM judge + 人工抽检。
