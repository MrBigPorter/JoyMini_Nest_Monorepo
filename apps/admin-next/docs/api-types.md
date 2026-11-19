# 前端 API 类型生成

> 设计依据：`openspec/changes/admin-frontend-closure/design.md` D4

## 它在解决什么

`src/type/types.ts` 是手写契约，与后端 DTO 会漂移。现在以前端仓库里已提交的
OpenAPI spec 为唯一来源，生成 `src/type/generated-api.d.ts`，CI 检查生成物是否
与 spec 同步。

## 涉及文件

| 文件 | 作用 |
|---|---|
| `apps/swagger-docs/swagger-spec.json` | 已提交的 OpenAPI 3.0 spec（类型源） |
| `apps/admin-next/scripts/generate-api-types.mjs` | 生成脚本，只读 spec、不联网、不启动后端 |
| `apps/admin-next/src/type/generated-api.d.ts` | 生成物，**不要手改**，需要提交进仓库 |
| `apps/admin-next/src/type/types.ts` | 手写视图模型；逐步用生成类型替换重叠部分 |

## 生成类型

```bash
yarn workspace @lucky/admin-next generate:api-types
```

产物文件头会带 `AUTO-GENERATED` 标记。生成是确定性的：同样的 spec 得到逐字节相同的文件。

## 刷新 spec（人工步骤）

spec 不是自动更新的。后端接口变化后，需要：

```bash
# 该命令会启动 AppModule（需要本地 db/redis 等依赖），属于人工/发布前步骤
yarn workspace @lucky/api export:swagger:full
```

然后重新生成类型并一起提交。**CI 不会替你发现 spec 过期** —— 它只校验
「类型文件与已提交的 spec 一致」（见设计 D4 的边界说明）。

## CI 行为

`.github/workflows/ci.yml` 的 check job 会：

1. 确认 `generated-api.d.ts` 已提交（缺失直接失败）；
2. 运行生成脚本；
3. `git diff --exit-code` 检查生成物是否与提交内容一致。

下面两种情况会让 CI 失败：

- 改了 `swagger-spec.json` 但没重新生成类型；
- 手改了 `generated-api.d.ts`。

## 从零验证一次

```bash
git status --short                      # 工作区应为干净（除本次改动）
yarn workspace @lucky/admin-next generate:api-types
git add apps/admin-next/src/type/generated-api.d.ts   # 首次生成后需要提交
yarn workspace @lucky/admin-next generate:api-types
git diff --exit-code -- apps/admin-next/src/type/generated-api.d.ts
yarn workspace @lucky/admin-next tsc --noEmit
```

## 已知边界

- 生成类型是**接口契约**（DTO），不是页面视图模型。字段命名可能不同（例如后端
  `relateType` 与前端 `relatedType`），替换时要逐页做映射，不能全局重命名。
- `packages/shared` 的枚举与 `x-field-meta` 产物（`gen-types`）保持现状，不并入本流程。
