# 88 · 知识库元数据合并与入库校验（N-3）— SDD

> 版本: v1.2
> 状态: **已完成**（AC-1~AC-6 全部验证通过；2026-11-11 数据重传后 `verify-knowledge` PASS 27/27）
> 日期: 2026-11-11
> 关联: [#87 N-1 / N-3](./87-全项目问题总清单.md)、[#54 Admin 知识库 UI](./RAG/54-admin-rag-knowledge-base-ui-design.md)
> 对应代码: `apps/api/src/admin/rag/rag-sync.service.ts`、`apps/api/src/admin/rag/knowledge-metadata.util.ts`、`apps/api/scripts/cli/verify-knowledge.ts`

---

## 一、概述

### 1.1 背景

#87 N-1（知识库全量导入本地）执行后，库内 26 篇 / 296 chunk，暴露 4 个问题：

| # | 现象 | 根因 |
|:--:|---|---|
| 1 | 26 篇标题全部带 ` (domain)` 后缀，如 `Account Guide (user)` | `rag-sync.service.ts` 用 `overrides.domain` 拼接标题 |
| 2 | `size-guide` 的 `domain` 是 `user`，源文件 frontmatter 是 `product` | 合并顺序是 `overrides > frontmatter` |
| 3 | `vip-benefits` 的 `contentType` 是 `how-to`，源文件是 `policy` | 同上 |
| 4 | 缺 `coupon-rules`，无人发现 | #87 N-3：导入链路无完成校验 |

第 1~3 条同一根因：`rag-sync.service.ts` 第 3 步的**注释写「frontmatter > 用户填写 > 默认值」，代码实现却是 `overrides || frontmatter`，两者相反**。

### 1.2 设计原则

1. **单一事实来源**：`.md` 的元数据以文件 frontmatter 为准；overrides 只补 frontmatter 缺失的字段（PDF 没有 frontmatter，全部来自 overrides）。
2. **合并逻辑可单测**：从 service 中抽出纯函数，不依赖 DB / Nest 容器。
3. **校验只读**：N-3 的校验脚本只读数据库和源文件，不做任何写操作。

---

## 二、目标

| ID | 目标 | 衡量 |
|:--:|---|---|
| G1 | 合并规则集中为纯函数 | 单测覆盖 6 种输入组合 |
| G2 | 上传链路使用 G1，重传即可修正历史数据 | 重传后标题无后缀、domain/contentType 与 frontmatter 一致 |
| G3 | 提供入库完成校验 | `yarn workspace @lucky/api verify-knowledge` 返回 PASS/FAIL |

**本期不做**：改 Prisma schema、改 admin 前端、改 embedding 队列。

---

## 三、功能需求

### FR-1 纯函数 `mergeKnowledgeMetadata`

文件：`apps/api/src/admin/rag/knowledge-metadata.util.ts`

```ts
mergeKnowledgeMetadata(
  extracted: { title: string; metadata: Record<string, unknown> },
  overrides?: { domain?; locale?; keywords?; contentType?; priority? },
): {
  title: string; domain: string; locale: string;
  contentType: string; priority: string; keywords: string[];
}
```

合并优先级（逐字段独立判断）：

| 字段 | 优先级 | 默认值 |
|---|---|---|
| `domain` | frontmatter → overrides → 默认 | `general` |
| `locale` | frontmatter → overrides → 默认 | `en` |
| `contentType` | frontmatter → overrides → 默认 | `policy` |
| `priority` | frontmatter → overrides → 默认 | `P2` |
| `keywords` | frontmatter（数组）→ overrides（逗号串）→ 默认 | `[]` |
| `title` | frontmatter/提取器标题，**不拼接任何后缀** | — |

**验收**：

- `metadata.domain='product'`、`overrides.domain='user'` → 结果 `product`
- `metadata` 为空（PDF）、`overrides.domain='order'` → 结果 `order`
- 两者皆空 → `general`
- `title` 任何情况下都不含 ` (domain)`
- `metadata.keywords` 为数组时原样返回；为数组且空、overrides 有值 → 用 overrides 分割
- `metadata` 字段为空串 `''` 时视为缺失，回落到下一优先级

### FR-2 上传链路接入

文件：`apps/api/src/admin/rag/rag-sync.service.ts`

- 删除第 3 步内联的合并逻辑，改为调用 `mergeKnowledgeMetadata(doc, overrides)`。
- `docId` 仍为 `metadata.docId || 文件名去后缀`（不属于合并函数职责）。
- `locale` 取合并结果，用于 `docId_locale` 唯一键查询。

**验收**：上传 `.md` 且 overrides 全部留空时，DB 五字段与 frontmatter 一致。

### FR-3 只读校验脚本 `verify-knowledge`

文件：`apps/api/scripts/cli/verify-knowledge.ts`，新增 package script `verify-knowledge`。

对源目录每个 `.md`：

| 检查 | 判定 |
|---|---|
| 文档存在（docId + locale） | 不存在 → FAIL |
| `process_status = 'indexed'` | 其他值 → FAIL |
| `chunk` 数 > 0 | 0 → FAIL |
| 全部 chunk 的 `embedding IS NOT NULL` | 有空的 → FAIL |
| `domain / content_type / priority` 与 frontmatter 一致 | 不一致 → FAIL（列出两边值） |
| 标题与 frontmatter `title` 一致（用于抓历史后缀） | 不一致 → FAIL |
| chunk 数与本地切分（500/50、切正文，参数与 `rag-chunk.service.ts` 一致）**完全相等** | 不等 → FAIL（实测 26 篇全部 0 差值；将来调切分参数需同步改脚本常量） |

额外：库内存在、源目录没有的文档 → 列为 WARN（不判 FAIL）。

**验收**：

- 27 篇全部合规 → 退出码 0，输出 `PASS`
- 任意一篇不合规 → 退出码 1，逐条列出失败原因
- 脚本不产生任何写入

### FR-4 单元测试

文件：`apps/api/src/admin/rag/knowledge-metadata.util.spec.ts`

覆盖 FR-1 验收中的 6 种组合。

---

## 四、非功能需求

| 维度 | 要求 |
|---|---|
| 边界 | `metadata` 为 `{}` / 字段为空串 / `keywords` 非数组时不抛错 |
| 性能 | 校验脚本一次全表查询 + 一次 chunk 聚合，27 篇量级 < 2s |
| 安全 | 脚本只读；不打印任何密钥 |
| 可维护性 | 合并规则的优先级只存在于 `knowledge-metadata.util.ts` 一处 |
| 可观测性 | 脚本输出每篇的 `docId / status / chunks / embedded / 失败原因` |

---

## 五、接口定义

### 5.1 CLI

```bash
yarn workspace @lucky/api verify-knowledge
```

读取 `DEPLOY env`（`loadEnvForHost()`），源目录固定为
`apps/api/src/client/ai-customer/knowledge`。

### 5.2 输出格式

```
✅ PASS  contact-support        indexed  7/7 chunk   [common/policy/P0]
❌ FAIL  coupon-rules           missing
❌ FAIL  size-guide             indexed  13/13 chunk  domain: db=user file=product
```

退出码：`0` 全部通过；`1` 存在失败。

---

## 六、数据模型

无 schema 变更。使用现有 `KnowledgeDocument` / `DocumentChunk`。

---

## 七、业务流程

```
上传 .md
  → MarkdownExtractor 解析 frontmatter
  → mergeKnowledgeMetadata(frontmatter, overrides)   ← FR-1
  → upsert knowledge_documents (docId + locale)
  → 删除旧 chunks → 重新切分 → 向量化
```

修正历史数据：用不带 overrides 的方式重传同一批文件（upsert，`version + 1`）。

---

## 八、验收标准

| ID | 标准 | 验证方式 |
|:--:|---|---|
| AC-1 | `tsc --noEmit` 通过 | `yarn workspace @lucky/api tsc --noEmit --pretty` |
| AC-2 | 单测全绿 | `yarn workspace @lucky/api test -- knowledge-metadata` |
| AC-3 | 重传后 27 篇全部 `indexed` | `verify-knowledge` 退出码 0 |
| AC-4 | 标题无 ` (domain)` 后缀 | 校验脚本第 6 项 |
| AC-5 | `size-guide.domain=product`、`vip-benefits.content_type=policy` | 校验脚本第 5 项 |
| AC-6 | 校验脚本能识别缺失文档（构造 `coupon-rules` 缺失时退出码 1） | 手工验证 |

### 验收记录（2026-11-11）

| AC | 结果 | 证据 |
|:--:|:--:|---|
| AC-1 | ✅ | `tsc --noEmit` 0 error |
| AC-2 | ✅ | `knowledge-metadata.util.spec.ts` 6/6 |
| AC-3 | ✅ | 重传后 `verify-knowledge` → PASS 27/27，exit 0 |
| AC-4 | ✅ | 27 篇标题均无 ` (domain)` 后缀 |
| AC-5 | ✅ | `size-guide.domain=product`、`vip-benefits.content_type=policy` |
| AC-6 | ✅ | 构造 `coupon-rules` 缺失 → exit 1 |

> 补充：302/302 chunk 均有向量（含补跑 contact-support 6 个、platform-rules 3 个）；N-6 修复见 #87、提交 `de8e8f0e`。

---

## 九、附录

- 合并规则的历史包袱：PDF 无 frontmatter，因此 overrides 必须保留「补缺」能力，不能直接删除。
- 前端 Upload 弹窗（`KnowledgeBaseClient.tsx:433-437`）只在字段非空时传 overrides，与「补缺」语义一致。

---

## 变更记录

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-11-11 | v1.0 | 首版：#87 N-1 执行后暴露的元数据问题 + N-3 校验 |
| 2026-11-11 | v1.1 | 代码落地：新增 `knowledge-metadata.util.ts`（+6 个单测）、`rag-sync.service.ts` 接入、`verify-knowledge` CLI；顺手修正 `contact-support.en.md` 的 `domain: rag` → `common` |
| 2026-11-11 | v1.2 | 状态改为已完成：AC-1~AC-6 全部通过（重传 27 篇 + 补跑 9 个缺失 chunk，302/302 有向量）；补「验收记录」表 |
