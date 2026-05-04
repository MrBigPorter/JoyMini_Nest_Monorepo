---
title: 'admin-next BuildInfo + 工具函数——构建元数据展示与角色常量'
slug: admin-next-build-info-utilities
tags: Next.js, Admin, TypeScript, Build Info, DevOps, CI/CD, Role Management
description: A deep dive into the admin-next utility modules — the BuildInfoViewModel system for displaying deployment metadata (build time, Git SHA) in the UI, and the ROLE_DISPLAY_NAMES constant for role-based permission display.
---

# admin-next BuildInfo + 工具函数——构建元数据展示与角色常量

> **Article A16** — The admin-next project includes a set of lightweight utility modules that handle build metadata display and role name constants. The `BuildInfoViewModel` provides a formatted view of deployment information (timestamp + Git commit SHA), while `ROLE_DISPLAY_NAMES` maps internal role codes to human-readable names.

- **Source**: [`build-info.ts`](apps/admin-next/src/lib/build-info.ts) (61L), [`constants.ts`](apps/admin-next/src/constants.ts) (11L)
- **Pattern**: ViewModel pattern for UI presentation
- **Series**: admin-next Architecture Deep Dive

---

## 1. 背景

管理后台的页脚或设置页面中，通常需要显示**构建信息**：部署时间、Git 提交 SHA、构建环境等。这些信息对以下场景至关重要：

- **运维排障**：快速确认当前运行的是哪个版本的代码
- **回归验证**：确认修复是否已部署到目标环境
- **环境区分**：区分 local-dev、staging、production 等环境
- **审计追踪**：记录哪个版本的代码产生了特定行为

admin-next 的 [`build-info.ts`](apps/admin-next/src/lib/build-info.ts) 模块将这些构建元数据封装为一个 `BuildInfoViewModel`，方便在 UI 中渲染。

此外，[`constants.ts`](apps/admin-next/src/constants.ts) 提供了 `ROLE_DISPLAY_NAMES` 常量映射，集中管理管理员角色的显示名称。

---

## 2. BuildInfoViewModel——构建信息展示模型

### 2.1 数据模型

[`BuildInfoViewModel`](apps/admin-next/src/lib/build-info.ts:1) 定义了 UI 展示所需的所有构建元数据字段：

```typescript
export interface BuildInfoViewModel {
  label: string;       // 显示文本："2026-05-03 15:00 UTC" 或 "Local build"
  shortSha: string | null;  // Git SHA 前 7 位："a1b2c3d"
  fullSha: string | null;   // 完整 Git SHA："a1b2c3d4e5f6..."
  tooltip: string;     // 悬停提示："2026-05-03 15:00 UTC · commit a1b2c3d4e5f6..."
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `label` | `string` | 主显示文本，格式化的 UTC 时间或 "Local build" |
| `shortSha` | `string \| null` | Git SHA 前 7 位，用于紧凑显示 |
| `fullSha` | `string \| null` | 完整 Git SHA，用于详细展示或复制 |
| `tooltip` | `string` | 组合信息，用于 `<Tooltip>` 组件的内容 |

### 2.2 buildBuildInfoViewModel 函数

[`buildBuildInfoViewModel`](apps/admin-next/src/lib/build-info.ts:23) 是模块的核心导出函数：

```typescript
export function buildBuildInfoViewModel(
  deployedAt?: string,
  gitSha?: string,
): BuildInfoViewModel | null {
  const normalizedDeployedAt = deployedAt?.trim();
  const normalizedGitSha = gitSha?.trim();

  if (!normalizedDeployedAt && !normalizedGitSha) {
    return null;
  }

  const isLocalBuild =
    normalizedDeployedAt === 'local-dev' || normalizedGitSha === 'local-dev';

  const label = isLocalBuild
    ? 'Local build'
    : normalizedDeployedAt
      ? (formatUtc(normalizedDeployedAt) ?? normalizedDeployedAt)
      : 'Build time unavailable';

  const fullSha =
    normalizedGitSha && normalizedGitSha !== 'local-dev'
      ? normalizedGitSha
      : null;
  const shortSha = fullSha ? fullSha.slice(0, 7) : null;

  const tooltipParts = [label];
  if (fullSha) {
    tooltipParts.push(`commit ${fullSha}`);
  }

  return {
    label,
    shortSha,
    fullSha,
    tooltip: tooltipParts.join(' · '),
  };
}
```

### 2.3 输入输出示例

| deployedAt | gitSha | 结果 |
|---|---|---|
| `"2026-05-03T15:00:00Z"` | `"a1b2c3d4e5f6789abcdef"` | `{ label: "2026-05-03 15:00 UTC", shortSha: "a1b2c3d", fullSha: "a1b2c3d...", tooltip: "2026-05-03 15:00 UTC · commit a1b2c3d..." }` |
| `"local-dev"` | `"local-dev"` | `{ label: "Local build", shortSha: null, fullSha: null, tooltip: "Local build" }` |
| `undefined` | `undefined` | `null` |
| `"2026-05-03T15:00:00Z"` | `undefined` | `{ label: "2026-05-03 15:00 UTC", shortSha: null, fullSha: null, tooltip: "2026-05-03 15:00 UTC" }` |

### 2.4 空值处理

当 `deployedAt` 和 `gitSha` 都为空时，函数返回 `null`。这包括以下情况：

- 构建时未注入环境变量
- 本地开发环境未配置 CI/CD
- 构建脚本出现异常

UI 端通过判断返回值是否为 `null` 来决定是否渲染构建信息区域：

```tsx
const buildInfo = buildBuildInfoViewModel(
  process.env.NEXT_PUBLIC_DEPLOYED_AT,
  process.env.NEXT_PUBLIC_GIT_SHA,
);

{buildInfo && (
  <Tooltip content={buildInfo.tooltip}>
    <span className="text-xs text-gray-400">
      {buildInfo.label}
      {buildInfo.shortSha && ` (${buildInfo.shortSha})`}
    </span>
  </Tooltip>
)}
```

---

## 3. formatUtc——日期格式化

[`formatUtc`](apps/admin-next/src/lib/build-info.ts:8) 是一个内部辅助函数，将 ISO 8601 字符串格式化为人类可读的 UTC 时间：

```typescript
function formatUtc(isoLike: string): string | null {
  const date = new Date(isoLike);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');

  return `${year}-${month}-${day} ${hour}:${minute} UTC`;
}
```

### 3.1 设计要点

| 特点 | 说明 |
|------|------|
| **UTC 优先** | 统一使用 UTC 时间，避免时区混淆 |
| **容错性** | `Date.parse` 失败时返回 `null`，而非抛出异常 |
| **无依赖** | 纯 JavaScript 实现，无需 `date-fns` 或 `dayjs` |
| **格式规范** | `YYYY-MM-DD HH:mm UTC` — 无歧义、易阅读 |

### 3.2 有效/无效输入

```typescript
formatUtc('2026-05-03T15:00:00Z');       // "2026-05-03 15:00 UTC"
formatUtc('2026-05-03T15:00:00.000Z');    // "2026-05-03 15:00 UTC"
formatUtc('not-a-date');                   // null
formatUtc('');                             // null
formatUtc('local-dev');                    // null（但此路径不会触发，由上层提前过滤）
```

---

## 4. CI/CD 注入

构建信息通常由 CI/CD 流水线在构建时注入环境变量：

### 4.1 Docker 构建

```dockerfile
# Dockerfile
ARG DEPLOYED_AT
ARG GIT_SHA
ENV NEXT_PUBLIC_DEPLOYED_AT=$DEPLOYED_AT
ENV NEXT_PUBLIC_GIT_SHA=$GIT_SHA
```

### 4.2 GitLab CI

```yaml
# .gitlab-ci.yml
build:
  script:
    - docker build
      --build-arg DEPLOYED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
      --build-arg GIT_SHA=$CI_COMMIT_SHA
      -t $CI_REGISTRY_IMAGE:$CI_COMMIT_TAG
      .
```

### 4.3 本地开发

在 `local-dev` 环境中，环境变量不会被注入，`buildBuildInfoViewModel` 返回 `null`，UI 不展示构建信息。或者可以通过 `.env.local` 模拟：

```env
# .env.local (local development)
NEXT_PUBLIC_DEPLOYED_AT=local-dev
NEXT_PUBLIC_GIT_SHA=local-dev
```

---

## 5. ROLE_DISPLAY_NAMES——角色常量映射

[`constants.ts`](apps/admin-next/src/constants.ts) 文件定义了管理员角色的显示名称映射：

```typescript
export const ROLE_DISPLAY_NAMES: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  EDITOR: 'Editor',
  VIEWER: 'Viewer',
  FINANCE: 'Finance',
};
```

### 5.1 角色说明

| 角色代码 | 显示名称 | 权限范围 |
|----------|----------|---------|
| `SUPER_ADMIN` | Super Admin | 全部权限，包括系统设置和用户管理 |
| `ADMIN` | Admin | 除系统设置外的全部管理权限 |
| `EDITOR` | Editor | 内容管理（商品、分类、文章） |
| `VIEWER` | Viewer | 只读权限，可查看报表 |
| `FINANCE` | Finance | 财务相关（订单、支付、对账） |

### 5.2 使用场景

```tsx
// 在 Select 组件中渲染角色下拉
import { ROLE_DISPLAY_NAMES } from '@/constants';

<Select label="Role">
  {Object.entries(ROLE_DISPLAY_NAMES).map(([value, label]) => (
    <option key={value} value={value}>{label}</option>
  ))}
</Select>
```

```typescript
// 在用户详情页面显示角色
const roleLabel = ROLE_DISPLAY_NAMES[user.role] ?? user.role;
```

### 5.3 设计原则

| 原则 | 说明 |
|------|------|
| **集中管理** | 所有角色名称在一个地方定义，避免散落在各个组件中 |
| **英文显示** | 管理后台使用英文角色名称，与 API 返回的枚举值一致 |
| **Record 类型** | 使用 `Record<string, string>` 而非联合类型，便于扩展 |
| **fallback** | `?? user.role` 确保未知角色也能显示原始值 |

---

## 6. 总结

admin-next 的 `BuildInfo` 和角色常量模块虽然代码量很小，但承担了重要的**信息展示**和**配置集中化**职责。

### 关键要点

- **BuildInfoViewModel**：四字段模型（label、shortSha、fullSha、tooltip）涵盖构建信息的全部展示需求
- **buildBuildInfoViewModel**：非空输入返回 ViewModel，空输入返回 `null`，方便 UI 条件渲染
- **formatUtc**：零依赖的 UTC 日期格式化，容错处理确保不崩溃
- **CI/CD 集成**：`NEXT_PUBLIC_DEPLOYED_AT` 和 `NEXT_PUBLIC_GIT_SHA` 环境变量由构建流水线注入
- **ROLE_DISPLAY_NAMES**：五个角色（SUPER_ADMIN、ADMIN、EDITOR、VIEWER、FINANCE）的集中式显示名称映射
