# 标注工作表（本地生成，不入库）

工作表含用户原问题/AI 回答，可能包含 PII，因此 `*.jsonl` 已 gitignore。

生成：

```bash
cd apps/api
../../node_modules/.bin/tsx --env-file=.env scripts/export-annotation-worksheet.ts \
  --dataset tools/eval/conversation/selection-2026-11-21.jsonl \
  --out tools/eval/conversation/annotations/worksheet-2026-11-21.jsonl
```

标注后用管理端标注页保存，标签落库 `ai_eval_annotations`
（作用域 `worksheet:<文件名>`，预标注 labeler_id='prelabel'）。
离线 kappa 需要 JSONL 时从 `GET /v1/admin/ai-eval/annotations/export?worksheet=<文件名>`
导出，再用 `annotate.py score` 计算。
