# Intent 示例配置化架构

> 目标: 新增 intent domain 不再需要改代码，全部通过 admin 面板配置
> 日期: 2026-07-16

---

## 当前问题

新增一个 intent domain（如 `human_support`）需要：

1. `intent-label-categories.ts` — 加一条 **（代码）**
2. `intent-examples/xxx.ts` — 新建示例文件 **（代码）**
3. `intent-examples/index.ts` — import + 注册 **（代码）**
4. Admin 可覆盖示例 **（配置）**

步骤 2-3 其实可以通过 admin 面板完成，但因为 admin 的 domain 列表只从 `INTENT_EXAMPLE_GROUPS` 读取，新 domain 必须先有代码注册才能在 admin 看到。

## 目标架构

```text
INTENT_LABEL_CATEGORIES (代码) ─→ Admin 展示所有 categories
                                      │
                              Admin 新建 domain + 例句
                                      │
                              intent_examples 表 (DB)
                                      │
                              IntentClassifier 从 DB 读取
```

**核心变化**: Admin 的 domain 列表改为从 `INTENT_LABEL_CATEGORIES` + DB 合并，不再依赖 `INTENT_EXAMPLE_GROUPS`。

## 改动清单

### 1. Admin intent-examples service

| 文件                                        | 改动                                                        |
| ------------------------------------------- | ----------------------------------------------------------- |
| `intent-examples.service.ts:getAll()`       | 合并 `INTENT_LABEL_CATEGORIES` 而非 `INTENT_EXAMPLE_GROUPS` |
| `intent-examples.service.ts:getByDomain()`  | 允许从 `INTENT_LABEL_CATEGORIES` 查找（无示例时返回空列表） |
| `intent-examples.service.ts:createDomain()` | 无改动（已支持任意 domain）                                 |
| `intent-examples.service.ts:updateDomain()` | 无改动                                                      |

### 2. Intent-examples/index.ts（可选清理）

| 文件                       | 改动                                              |
| -------------------------- | ------------------------------------------------- |
| `intent-examples/index.ts` | 示例数据保留为 seed 默认值，不再作为 admin 数据源 |

### 3. 删除文件（可选）

| 文件                               | 说明                            |
| ---------------------------------- | ------------------------------- |
| `intent-examples/human-support.ts` | 已创建，示例可迁入 admin 后删除 |

## 效果

新增 intent domain 只需：

1. 去 Admin 面板填 domain 名 + 示例句子 → 自动生成 embeddings
2. 无需改任何代码

已存在的 domain（order/wallet/coupon/...）通过 seed 保持默认示例，
admin 可随时覆盖或追加。
