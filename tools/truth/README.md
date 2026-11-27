# 真值一致性校验（ai-truth-layer）

校验「知识库文档宣称的渠道事实」是否等于「`payment_channels` 表里的配置」，并守住另一类运行期载体：**生效中的提示词版本不得写死费率/金额**。确定性脚本，不调用任何模型。

## 结构

| 文件 | 作用 |
|---|---|
| `registry.json` | 登记：每条事实的键（`<CHANNEL_CODE>.<available\|fee\|min\|max>`）、所在文档行、真值字段 |
| `scan.mjs` | 扫文档表格，按行内标记 `<!-- truth: <key> -->` 提取声明 |
| `cell.mjs` | 按登记的形式（`flat` / `rate_plus_fixed` / `amount`）解析单元格 |
| `source.mjs` | 只读 HTTP 来源（只发 GET），取渠道配置、文档正文与生效提示词 |
| `compare.mjs` | 逐条比对，给出 `pass` / `fail` 与原因 |
| `prompts.mjs` | 扫生效提示词的字符串：百分比、货币金额、`N pesos` 字面量即违规 |
| `runner.mjs` | 汇总：解析失败、来源不可达、提示词写死事实、零条比对都判失败 |
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

## 提示词为什么也扫

提示词的生效版本由管理端激活，`PromptResolverService.mergeConfig` 会把它覆盖到代码默认配置上，直接进入回答正文——和知识库文档同一个风险面，但没有任何 PR 能拦住。守卫扫 `status=active` 且带生效版本的每个字符串，命中以下任一即失败并给出提示词、版本、字段路径：

- 百分比：`0.8%`
- 货币金额：`₱100`、`PHP 80,000`
- 数字 + pesos：`15 pesos`

指向工具结果的占位写法不会命中（`₱[amount from tool result]`、`[progress from result]%`）。裸数字不判（`1-3 business days` 是流程描述）。百分比一律判违规，包括 `100%`——真要表达「完全」请改词。

意图示例（`intent_examples`）不扫：它只做路由分类、不进入回答正文，且实测 783 行中仅 2 行带金额且都不是事实声明；扫它反而会把用户问句误报为违规。理由与边界见 design D13。

读取提示词失败（不可达、超时、结构不符）判失败；集合为空不判失败，但报告会写「0 个生效版本（该环境未启用 DB 提示词，运行期使用代码默认配置）」——prod 就是这种状态，把空集合当失败会让校验永久红。

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
