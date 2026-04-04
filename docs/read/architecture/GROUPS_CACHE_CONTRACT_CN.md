# Groups 缓存契约（Phase 6 P0 / 单页面）

> 日期：2026-03-23  
> 范围：`groups`（`GroupManagementClient.tsx`）

---

## 1. 问题

### Q1：为什么 `groups` 也适合直接复用“Server 预取 + Hydration”模式？

**答案：它是典型的单页列表场景，读接口稳定、参数维度少、且已接入 `SmartTable`，非常适合复用 `operation-logs` 的最小改动路径。**
改造前的痛点：

- URL 参数解析和 API 参数整形散落在组件内部
- 页面级还没有统一 query key
- 首屏仍依赖客户端请求，刷新无法稳定复用同一份预取结果

---

## 2. 本次契约定义

新增文件：

- `apps/admin-next/src/lib/cache/groups-cache.ts`
  统一能力：

1. `parseGroupsSearchParams`
   - 解析 `treasureId/status/includeExpired`
   - `includeExpired` 缺省时统一视为 `false`
2. `buildGroupsListParams`
   - 统一客户端 / 服务端请求参数? Groups 缓存契约（Phase 6 P0 / 单页面）> 日期：2026-03-23  
      > 范围：`groups`（`Group??> 日期：2026-03-23  
范围：`groups`（`G?? 范围：`groups`（??--

## 1. 问题

### Q1：为什么 `groups` 也适?#??### Q1：䖇?\*答案：它是典型的单页列表场景，读接口稳定、参数维度少、且巋???造前的痛点：

- URL 参数解析和 API 参数整形散落在组件内部
- 页面级还没有统一 query key
- 首屏tionBoundary` 注水
- `apps/admin-next/src/com- URL 参数解析?a- 页面级还没有  - 接入 `enableHydration + hydrationQ- 首屏仍依赖客户端请求，?--

## 2. 本次契约定义

新增文件：

- `apps/adm 的 URL 回写职责
- `##ou新增文件：
- `apps? `apps/admin-e`统一能力：

1. `parseGroupsSearchParams`
   ?什么 `includeEx   - 解析 `treasureId/s收? - `includeExpired` 缺省时统一视为 `??. `buildGroupsListParams`
   - 统一客户端 / ? - 统一客户端 / ?e> 日期：2026-03-23 > 范围：`groups`（`Group??> 日期：2026-03-23  
范围：`us` ? 范围：`groups`（ir> 范围：`groups`（`G?? 范围：`groups`（??-?# 1. 问题

### Q1：为什么 `groups` 也适?#???### Q1：中? URL 参数解析和 API 参数整形散落在组件内部

- 页面级还没有统一 query key
- 首屏tionBoundary` 注水
- `apps/admin-next/src/com- URL 参敯?- 页面级还没有统一 query key
- 首屏tionBoundary`st- 首屏tionBoundary` 注水
- `app? `apps/admin-next/src/com-le## 2. 本次契约定义
  新增文件：
- `apps/adm 的 URL 回写职责
- `##ou新增文件：
- `apps? `apps/admin-e`统一能力：

1. `parse????增文件：

- `apps? `apps/adm 皀?- `##ou新增文件：
- `apps种- `apps? `apps/admi?. `parseGroupsSearchParams`   ?什么?  ?什么`includeEx - ?? - 统一客户端 / ? - 统一客户端 / ?e> 日期：2026-03-23
  > 范围：`groups`（`Group??> 日期：2026-??> 范围：`groups`（`Group?python3 - <<'PY'
  > from pathlib import Path
  > content = '''# Groups 缓存契约（Phase 6 P0 / 单页面）
  > 日期：2026-03-23  
  > 范围：`groups`（`GroupManagementClient.tsx`）

---

## 1. 问题

### Q1：为什么 `groups` 也适合直接复用“Server 预取 + Hydration”模式？

**答案：它是典型的单页列表场景，读接口稳定、参数维度少、且已接入 `SmartTable`，非常适合复用 `operation-logs` 的最小改动路径。**
改造前的痛点：

- URL 参数解析和 API 参数整形散落在组件内部
- 页面级还没有统一 query key
- 首屏仍依赖客户端请求，刷新无法稳定复用同一份预取结果

---

## 2. 本次契约定义

新增文件：

- `apps/admin-next/src/lib/cache/groups-cache.ts`
  统一能力：

1. `parseGroupsSearchParams`
   - 解析 `treasureId/status/includeExpired`
   - `includeExpired` 缺省时统一视为 `false`
2. `buildGroupsListParams`
   - 统一客户端 / 服务端请求参数输出
3. `groupsListQueryKey`
   - 确保 `page.tsfrom pathlib imrocontent = '''# Groups ??> 日期：2026-03-23
     > 范围：`groups`（`GroupManagemen?? 范围：`groups`（??--

## 1. 问题

### Q1：为什么 `groups` ：这?#??### Q1：万?\*答案：它是典型的单页列表场景，读接口稳定、参数维度少、且巋???造前的痛点：

- URL 参数解析和 API 参数整形散落在组件内部
- 页面级还没有统一 query key
- 首屏仍依赖客户端请求，刷新无法稳定om- URL 参数解析?a- 页面级还没有统一 query key
- 首屏仍依赖客?Q- 首屏仍依赖客户端请求，?--

## 2. 本次契约定义

新增文件：

- `apps/admin-next/src/lib/cache/g `##ou新增文件：
- `apps? `apps/admin-e`统一能力：

1. `parseGroupsSearchParams`
   ??. `parseGroupEx   - 解析 `treasureId/sta?? - `includeExpired` 缺省时统一视为 `??. `buildGroupsListParams`
   - 统一数据”，? - 统一客户端 / ?e3. `groupsListQueryKey`
   - 确保 `page.tsfrom ?    - 确保 `page.tsfr? 范围：`groups`（`GroupManagemen?? 范围：`groups`（??--

## 1. 问题

### IV## 1. 问题

### Q1：为什么 `groups` ：这?#??### Q1：???### Q1：中? URL 参数解析和 API 参数整形散落在组件内部

- 页面级还没有统一 query key
- 首屏仍依赖客户端请求，刷新无法稳定om- URL 参敯?- 页面级还没有统一 query key
- 首屏仍依赖客est- 首屏仍依赖客户端请求，? 首屏仍依赖客?Q- 首屏仍依赖客户端请求，?--

## 2. 本次契约定义

新增文件：

- `appsnP## 2. 本次契约定义
  新增文件：
- `apps/admin-next/sr????增文件：
- `apps? `apps/admin-??- `apps? `apps/admin-e`统一能力：

1. `parseGrou?. `parseGroupsSearchParams`??.`p? ??. `parseGroupEx   - ??   - 统一数据”，?  - 统一客户端 / ?e3. `groupsListQueryKey`
   - 确保 `page.tsfrom ?    - 确保 `page.t?? - 确保 `page.tsfrom ?    - 确保 `page.tsfr? 范围：`groups`（`re## 1. 问题

### IV## 1. 问题

### Q1：为什么 `groups` ：这?#??### Q1：???### Q1zsh -lc 'wc -c /Volumes/MySSD/work/dev/lucky_nest_monorepo/read/architecture/GROUPS_CACHE_CONTRACT_CN.md | cat'

PY
