# 中继流程 — 服务轮换方案

## 问题
服务器只有 8GB，无法同时运行所有服务。上传 PDF 需要切换服务组合。

## 当前服务组合

| 模式 | 包含服务 | 内存 | 用途 |
|:-----|:---------|:----:|:-----|
| **core** | db+redis+backend+nginx | ~800MB | 基础运行 |
| **ai** | core + ollama+infinity+meilisearch | ~5GB | AI 客服日常 |
| **pdf** | core + unstructured | ~1.1GB | PDF 解析 |

## 上传 PDF 的中继流程

```
Step 1: 停 AI 服务 → 启动 Unstructured → 上传 PDF → 解析文本 → 停 Unstructured
                    ↓
        文档状态变为 "parsed"（文本已入库，未切片向量化）
                    ↓
Step 2: 启动 ollama + meilisearch → 点"向量化" → embedding + BM25
                    ↓
        文档状态变为 "indexed"（完成）
                    ↓
Step 3: 恢复 AI 服务（ollama + infinity + meilisearch）
```

## 完整命令序列

```bash
# 上传 PDF 时
make stop-ai                    # 停 AI 服务，空出 ~4GB
make start-unstructured         # 启动 Unstructured
# → 在 Admin 面板上传 PDF（解析文本）
make stop-unstructured          # 解析完毕，释放 ~300MB

make start-ollama               # 启动向量化引擎（~2GB）
make start-meilisearch          # 启动 BM25 索引（~100MB）
# → 在 Admin 面板点"向量化"按钮
# → 自动完成 embedding + BM25 索引

# 如果需要 AI 客服
make start-infinity             # 启动 reranker（~2GB）
# 现在回到 AI 模式
```

## Makefile 新增命令

```makefile
## [Workflow] 📄 PDF 上传完整流程
upload-pdf:
	@echo "Step 1: 停 AI 服务..."
	@$(MAKE) stop-ai
	@echo "Step 2: 启动 Unstructured..."
	@$(MAKE) start-unstructured
	@echo "✅ 请在 Admin 面板上传 PDF"
	@echo "   上传完成后执行: make process-pdf"

## [Workflow] ⚙️ PDF 后续处理（向量化 + BM25）
process-pdf:
	@echo "Step 1: 停 Unstructured..."
	@$(MAKE) stop-unstructured
	@echo "Step 2: 启动 ollama + meilisearch..."
	@docker compose up -d ollama meilisearch
	@echo "✅ 请在 Admin 面板点击文档的'向量化'按钮"
	@echo "   完成后执行: make resume-ai"

## [Workflow] ▶️ 恢复 AI 服务
resume-ai:
	docker compose up -d ollama infinity meilisearch
```
