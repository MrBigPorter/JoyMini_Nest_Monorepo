# 真值一致性校验（ai-truth-layer）

校验「知识库文档宣称的渠道事实」是否等于「`payment_channels` 表里的配置」。确定性脚本，不调用任何模型。

## 结构

| 文件 | 作用 |
|---|---|
| `registry.json` | 登记：每条事实的键（`<CHANNEL_CODE>.<available\|fee\|min\|max>`）、所在文档行、真值字段 |
| `scan.mjs` | 扫文档表格，按行内标记 `<!-- truth: <key> -->` 提取声明 |
| `cell.mjs` | 按登记的形式（`flat` / `rate_plus_fixed` / `amount`）解析单元格 |
| `source.mjs` | 只读 HTTP 来源（只发 GET），取渠道配置与文档正文 |
| `compare.mjs` | 逐条比对，给出 `pass` / `fail` 与原因 |
| `runner.mjs` | 汇总：解析失败、来源不可达、零条比对都判失败 |
| `check.mjs` | CLI，退出码 0/1 |
| `apply-docs.mjs` | 运维脚本：把 `fixtures/docs/*.md` 定稿写回环境（唯一会写的地方） |
| `fixtures/` | 两篇文档的定稿内容，迁移与回归的基准 |

## 命令

API 带 URI 版本前缀，`--base-url` 要给到 `/api/v1`。

```bash
# 校验（本地）
TRUTH_ADMIN_TOKEN='<管理员令牌>' node tools/truth/check.mjs --base-url http://127.0.0.1:3000/api/v1

# 校验（线上）
TRUTH_ADMIN_TOKEN='<管理员令牌>' node tools/truth/check.mjs --base-url https://api.joyminis.com/api/v1

# 写回定稿（先 dry-run 看差异，再真写）
TRUTH_ADMIN_TOKEN='<管理员令牌>' node tools/truth/apply-docs.mjs --base-url http://127.0.0.1:3000/api/v1 --dry-run
TRUTH_ADMIN_TOKEN='<管理员令牌>' node tools/truth/apply-docs.mjs --base-url http://127.0.0.1:3000/api/v1
```

令牌取管理端登录后的 access token（`POST /api/v1/auth/admin/login` 的返回，或浏览器里管理端的 `auth_token` Cookie）。令牌只从环境变量读，脚本不打印它。

退出码：0 = 全部一致 / 全部写回并生效；1 = 有不一致、来源不可达、登记不可解析或写入后索引未切换。

校验还会要求文档的检索索引与当前正文同版本（`activeVersion === version`）。不相等时直接判失败并写明两个版本号——回滚只切分块版本、不还原 `content` 列，只比正文会得出假绿。

## 写回为什么必须走 API

`PATCH /admin/rag/documents/:id/content` 会重新切片、重算哈希与质量分、排队向量化，并在向量就绪后由 `KbVersionService` 切换 `activeVersion`。直接改库会让正文是新的、索引还停在旧内容。`apply-docs.mjs` 写完后会轮询到 `activeVersion` 切换为止，超时即失败。

## 回滚演练（task 3.2）

```bash
# 记下当前版本，再回滚到上一版 → 校验应变红
curl -s -X POST "http://127.0.0.1:3000/api/v1/admin/rag/documents/<id>/rollback" \
  -H "authorization: Bearer $TRUTH_ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"toVersion": <上一版>}'
TRUTH_ADMIN_TOKEN='<令牌>' node tools/truth/check.mjs --base-url http://127.0.0.1:3000/api/v1   # 期望退出码 1

# 切回新版本 → 校验应变绿
curl -s -X POST "http://127.0.0.1:3000/api/v1/admin/rag/documents/<id>/rollback" \
  -H "authorization: Bearer $TRUTH_ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"toVersion": <新版本>}'
TRUTH_ADMIN_TOKEN='<令牌>' node tools/truth/check.mjs --base-url http://127.0.0.1:3000/api/v1   # 期望退出码 0
```

## 测试

```bash
node --test tools/truth/*.test.mjs
```

注意要传 glob：`node --test tools/truth/` 会把目录当文件，报 `Cannot find module`。
