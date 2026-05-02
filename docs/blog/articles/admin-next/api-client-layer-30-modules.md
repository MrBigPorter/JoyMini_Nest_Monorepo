# API 客户端层：30+ 类型化模块模式

## 概述

管理后台通过定义在 [`api/index.ts`](apps/admin-next/src/api/index.ts)（1,145 行）中的**类型化 API 客户端层**与 NestJS 后端通信。该文件导出 **19 个 API 模块**（每个作为类型化的对象字面量），利用共享的 [`http`](apps/admin-next/src/api/http.ts) 客户端和集中式的 [`types`](apps/admin-next/src/api/types.ts) — 形成覆盖 30+ 后端端点的三文件 API 层，具有完整的 TypeScript 类型安全。

### 三个文件

| 文件 | 行数 | 角色 |
|------|-------|------|
| [`api/types.ts`](apps/admin-next/src/api/types.ts) | — | 共享响应包装器（`PaginatedResponse`、`RequestConfig`） |
| [`api/http.ts`](apps/admin-next/src/api/http.ts) | — | 带认证刷新、拦截器、上传支持的 HTTP 客户端 |
| [`api/index.ts`](apps/admin-next/src/api/index.ts) | 1,145 | 19 个类型化 API 模块，每个对应一个后端控制器 |

---

## 1. 19 个 API 模块

每个模块都是一个导出的 const 对象，其中的方法是调用 `http.get/post/patch/delete/upload` 并带有完整泛型类型参数的箭头函数。

| 模块 | 端点前缀 | 关键操作 |
|--------|----------------|----------------|
| [`userApi`](apps/admin-next/src/api/index.ts:72) | `/v1/admin/user/` | 后台用户的 CRUD |
| [`clientUserApi`](apps/admin-next/src/api/index.ts:95) | `/v1/admin/client-user/` | 列表、详情、设备、封禁/解封 |
| [`productApi`](apps/admin-next/src/api/index.ts:129) | `/v1/admin/treasure/` | CRUD + 状态切换 + 排序 + 缓存清理 |
| [`bannerApi`](apps/admin-next/src/api/index.ts:162) | `/v1/admin/banners/` | CRUD + 状态切换 |
| [`orderApi`](apps/admin-next/src/api/index.ts:189) | `/v1/admin/order/` | 列表、详情、状态更新、删除 |
| [`categoryApi`](apps/admin-next/src/api/index.ts:210) | `/v1/admin/category/` | CRUD + 状态切换 |
| [`groupApi`](apps/admin-next/src/api/index.ts:236) | `/v1/admin/groups/` | 列表、详情（拼团） |
| [`treasureApi`](apps/admin-next/src/api/index.ts:254) | `/treasure-groups/` | CRUD + 切换（宝物组） |
| [`actSectionApi`](apps/admin-next/src/api/index.ts:282) | `/v1/admin/act-sections/` | CRUD + 绑定/解绑商品 + 排序 |
| [`paymentChannelApi`](apps/admin-next/src/api/index.ts:331) | `/v1/admin/payment/channels/` | CRUD |
| [`couponApi`](apps/admin-next/src/api/index.ts:360) | `/v1/admin/coupons/` | CRUD |
| [`financeApi`](apps/admin-next/src/api/index.ts:393) | `/v1/admin/finance/` | 交易、提现、充值、审计、调整、统计 |
| [`addressApi`](apps/admin-next/src/api/index.ts:442) | `/v1/admin/address/` | 列表、详情、更新、删除 |
| [`regionApi`](apps/admin-next/src/api/index.ts:470) | `/v1/admin/region/` | 省、市、区（级联） |
| [`kycApi`](apps/admin-next/src/api/index.ts:490) | `/v1/admin/kyc/` | 记录、详情、审核、创建、更新、撤销、删除 |
| [`authApi`](apps/admin-next/src/api/index.ts:545) | `/v1/auth/admin/` | 登录、退出、设置/清除 cookie、刷新、获取当前用户 |
| [`uploadApi`](apps/admin-next/src/api/index.ts:591) | `/v1/admin/upload/` | 带进度的媒体/图片上传 |
| [`luckyDrawApi`](apps/admin-next/src/api/index.ts:600+) | `/v1/admin/lucky-draw/` | 活动、奖品、抽奖、结果 |
| [`systemConfigApi`](apps/admin-next/src/api/index.ts:1000+) | `/v1/admin/system-config/` | 系统配置管理 |

---

## 2. 模块模式剖析

每个模块遵循相同的结构：

```typescript
/**
 * 领域描述
 */
export const domainApi = {
  // 列表（分页）
  getList: (params?: DomainListParams) =>
    http.get<PaginatedResponse<DomainItem>>('/v1/admin/domain/list', params),

  // 详情
  getDetail: (id: string) => http.get<DomainItem>(`/v1/admin/domain/${id}`),

  // 创建
  create: (data: CreateDomainPayload) =>
    http.post<DomainItem>('/v1/admin/domain/create', data),

  // 更新
  update: (id: string, data: Partial<DomainItem>) =>
    http.patch<DomainItem>(`/v1/admin/domain/${id}`, data),

  // 删除
  delete: (id: string) => http.delete(`/v1/admin/domain/${id}`),
};
```

这种 CRUD 模式在 19 个模块中的 15 个中重复出现。其余 4 个有专门的操作：

### 专门操作

**财务** — 多步骤的审计工作流：
```typescript
financeApi.getTransactions(params)    // 列出钱包交易
financeApi.getWithdrawals(params)     // 列出提现订单
financeApi.withdrawalsAudit(data)     // 批准/拒绝提现
financeApi.adjust(data)               // 手动余额调整
financeApi.getDeposits(params)        // 列出充值订单
financeApi.getStatistics()            // 仪表盘财务汇总
financeApi.syncRecharge(id)           // 手动充值状态同步
```

**认证** — 带跳过刷新头的 Cookie + 令牌管理：
```typescript
authApi.login(data)                   // 管理员登录（跳过认证刷新）
authApi.logout()                      // 管理员退出
authApi.setCookie(token)              // 登录后设置 httpOnly cookie
authApi.clearCookie()                 // 退出时清除 httpOnly cookie
authApi.refreshToken(refreshToken)    // 令牌刷新
authApi.changePassword(data)          // 密码修改
authApi.getMe()                       // 页面刷新时恢复用户信息
```

**KYC** — 完整生命周期，包括管理员覆盖：
```typescript
kycApi.getRecords(params)             // 分页 KYC 列表
kycApi.getDetail(id)                  // 单条 KYC 记录详情
kycApi.audit(id, data)                // 通过/拒绝
kycApi.create(data)                   // 管理员创建的 KYC（线下验证）
kycApi.updateInfo(userId, data)       // 更正 KYC 信息
kycApi.revoke(userId, reason)         // 撤销已验证的 KYC
kycApi.delete(userId)                 // 硬删除记录
```

---

## 3. `x-skip-auth-refresh` 协议

API 层中的一个关键细节是 `x-skip-auth-refresh` 自定义头部，由 [`authApi`](apps/admin-next/src/api/index.ts:545) 的方法使用，以防止危险的无限循环：

```typescript
login: (data) =>
  http.post<LoginResponse>('/v1/auth/admin/login', data, {
    headers: { 'x-skip-auth-refresh': '1' },
  }),
```

**问题**：HTTP 拦截器（在 `http.ts` 中）会在收到 401 响应时自动尝试刷新令牌。如果登录本身返回 401（错误的凭证），拦截器会：
1. 看到 401 → 尝试刷新令牌 → 失败（还没有有效令牌）→ 重定向到 `/login`
2. 这错误地将凭证错误视为会话过期

**修复**：自定义头部告诉拦截器："这个请求是与认证相关的；跳过刷新逻辑。"拦截器在执行其 401 处理程序之前检查此头部。

此模式应用于：
- [`authApi.login()`](apps/admin-next/src/api/index.ts:549) — 登录请求（无现有令牌）
- [`authApi.setCookie()`](apps/admin-next/src/api/index.ts:558) — 设置 httpOnly cookie（刚获取令牌）
- [`authApi.clearCookie()`](apps/admin-next/src/api/index.ts:566) — 退出时清除 cookie

---

## 4. 类型安全链

API 层创建了从页面组件到后端的完整类型安全链：

```
组件                        API 模块               后端
   |                            |                        |
   v                            v                        v
useQuery({                    userApi.getUsers(params)  GET /v1/admin/user/list
  queryKey: ...,              ↑                         ↑
  queryFn: () =>              Returns                   Returns
    userApi.getUsers(         PaginatedResponse         JSON matching
      buildUsersListParams(     <AdminUser>               PaginatedResponse
        input)                                            <AdminUser>
      )
})                            ↑                         ↑
                          api/types.ts 中的类型    @/type/types.ts 中的类型
                                                    （共享类型包）
```

这个链意味着：
- 共享类型包中的**类型变更**会自动传播到组件
- 在 API 模块中**重构**端点路径会更新所有消费者
- **错误的参数类型**在编译时而非运行时被捕获

---

## 5. 带进度的上传模块

[`uploadApi`](apps/admin-next/src/api/index.ts:591) 模块通过进度跟踪扩展了模式：

```typescript
uploadMedia: (
  file: File,
  onProgress?: (percent: number) => void,
  extraFields?: Record<string, string>,
) =>
  http.upload<{ url: string; key: string }>(
    '/v1/admin/upload/image',
    file,
    onProgress,
    extraFields,
  ),
```

这包装了 `XMLHttpRequest`（支持 `upload.onprogress`）而非 `fetch`，从而在大型文件上传期间实现进度条。`extraFields` 参数允许将元数据（例如文章 ID、上传上下文）作为多部分表单字段附加。

---

## 6. 对比：API 模块 vs 直接 HTTP 调用

| 方面 | 使用 API 模块 | 直接 `http.get()` |
|--------|-----------------|-------------------|
| 端点 URL | 集中式，单一事实源 | 分散在各组件中 |
| 类型安全 | 泛型参数保证响应类型 | 容易忘记泛型 |
| 重构 | 修改一个文件 | 查找所有调用者 |
| 可发现性 | 一个文件列出所有可用端点 | 隐藏在组件代码中 |
| 错误处理 | 通过拦截器保持一致 | 不一致 |

---

## 7. 模块组织图

```
api/
├── http.ts              # HTTP 客户端（基础 URL、拦截器、认证刷新）
├── types.ts             # PaginatedResponse<T>、RequestConfig、PaginationParams
└── index.ts             # 19 个 API 模块：
    ├── userApi          # /v1/admin/user/*
    ├── clientUserApi    # /v1/admin/client-user/*
    ├── productApi       # /v1/admin/treasure/*
    ├── bannerApi        # /v1/admin/banners/*
    ├── orderApi         # /v1/admin/order/*
    ├── categoryApi      # /v1/admin/category/*
    ├── groupApi         # /v1/admin/groups/*
    ├── treasureApi      # /treasure-groups/*
    ├── actSectionApi    # /v1/admin/act-sections/*
    ├── paymentChannelApi # /v1/admin/payment/channels/*
    ├── couponApi        # /v1/admin/coupons/*
    ├── financeApi       # /v1/admin/finance/*
    ├── addressApi       # /v1/admin/address/*
    ├── regionApi        # /v1/admin/region/*
    ├── kycApi           # /v1/admin/kyc/*
    ├── authApi          # /v1/auth/admin/*
    ├── uploadApi        # /v1/admin/upload/*
    ├── luckyDrawApi     # /v1/admin/lucky-draw/*
    └── systemConfigApi  # /v1/admin/system-config/*
```

---

## 关键要点

1. **19 个类型化 API 模块**在单个文件中提供了对 30+ 后端端点的集中式、类型安全访问，具有完整的 TypeScript 泛型。
2. **CRUD 模式**（列表/详情/创建/更新/删除）覆盖 15 个模块；其余 4 个（财务、认证、KYC、上传）有专门的操作。
3. **认证端点上的 `x-skip-auth-refresh` 头部**防止拦截器将登录凭证错误误解为会话过期。
4. **上传模块**带有进度回调，包装了 `XMLHttpRequest` 以实现文件上传进度条。
5. **三文件架构**（`http.ts` + `types.ts` + `index.ts`）提供了清晰的分离：传输层、共享类型和端点定义。
6. **端到端类型安全**从 React Query hook 开始，经过 API 模块，通过共享类型延伸到后端响应结构。
