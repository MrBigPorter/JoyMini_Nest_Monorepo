---
title: '客户端用户管理 — admin 后台用户列表、详情、封禁与设备风控'
description: 'ClientUserController（列表/详情/状态更新/设备管理）→ ClientUserService（动态 WHERE 查询、DeviceBlacklist 风控、Redis 同步）→ UserListClient（useQuery + tanstack table + SchemaSearchForm）→ UserDetailModal（Tabs: 概览/设备/日志 + Sidebar 封禁操作）'
slug: admin-client-user-management
tags: admin-next, User Management, Device Blacklist, KYC, Redis, Prisma, Permissions
---

# 客户端用户管理 — admin 后台用户列表、详情、封禁与设备风控

## 1. 背景

在管理后台中，**客户端（Client）用户管理**是最基础也最常用的功能之一。管理员需要能够：

- 查看所有注册用户的列表与基本信息
- 按手机号、用户ID、KYC状态、账号状态、注册时间等维度搜索
- 查看用户详情（余额、设备、登录日志）
- 封禁/解冻用户账号
- 拉黑/解封用户设备（风控）

本篇文章聚焦于 admin 后台对 **客户端用户（而非管理端用户）** 的管理功能，涵盖从 API 到前端组件的完整实现。

### 相关权限

所有接口通过 [`PermissionsGuard`](apps/api/src/common/guards/permissions.guard.ts) 配合 [`@RequirePermission`](apps/api/src/common/decorators/require-permission.decorator.ts) 装饰器控制：

| 操作 | 权限声明 | 说明 |
|------|----------|------|
| 查看列表/详情 | `OpModule.USER + OpAction.USER.VIEW` | 查看用户信息 |
| 封禁/解冻 | `OpModule.USER + OpAction.USER.UPDATE` | 修改用户状态 |
| 设备拉黑 | 无额外限制（内部调用） | 风控操作 |

---

## 2. API 控制器

[`ClientUserController`](apps/api/src/admin/client-user/client-user.controller.ts:34) 暴露了 6 个端点，全部受 `JwtAuthGuard` + `PermissionsGuard` 保护：

```typescript
@ApiTags('admin/client-user')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/client-user')
export class ClientUserController {
  constructor(private readonly clientUserService: ClientUserService) {}

  // GET /admin/client-user/list — 用户列表（分页 + 搜索）
  @Get('list')
  @RequirePermission(OpModule.USER, OpAction.USER.VIEW)
  async findAll(@Query() dto: QueryClientUserDto) { ... }

  // GET /admin/client-user/:id — 用户详情
  @Get(':id')
  @RequirePermission(OpModule.USER, OpAction.USER.VIEW)
  async findOne(@Param('id') id: string) { ... }

  // PATCH /admin/client-user/:id/status — 更新用户状态（封禁/解冻）
  @Patch(':id/status')
  @RequirePermission(OpModule.USER, OpAction.USER.UPDATE)
  async updateStatus(@Body() dto: UpdateUserStatusDto, @Param('id') id: string) { ... }

  // GET /admin/client-user/:id/devices — 获取用户设备列表
  @Get(':id/devices')
  @RequirePermission(OpModule.USER, OpAction.USER.VIEW)
  async getUserDevices(@Param('id') id: string) { ... }

  // POST /admin/client-user/device/ban — 拉黑设备
  @Post('device/ban')
  banDevice(@Body() dto: BanDeviceDto, @CurrentUserId() adminId: string) { ... }

  // DELETE /admin/client-user/device/unban/:deviceId — 解封设备
  @Delete('device/unban/:deviceId')
  unbanDevice(@Param('deviceId') deviceId: string) { ... }
}
```

### 2.1 查询参数 DTO

[`QueryClientUserDto`](apps/api/src/admin/client-user/dto/client-user.dto.ts:20) 定义了列表搜索的 7 个参数：

```typescript
export class QueryClientUserDto {
  @ToInt() @IsInt() @Min(1)
  page: number = 1;

  @ToInt() @IsInt() @Min(1)
  pageSize: number = 20;

  @IsOptional() @IsString()
  phone?: string;           // 手机号模糊查询

  @IsOptional() @IsString()
  userId?: string;          // 用户ID精确查询

  @IsOptional() @ToInt() @IsInt()
  kycStatus?: number;       // KYC状态: 0-未认证 1-审核中 4-已认证

  @IsOptional() @ToInt() @IsInt() @IsEnum([0, 1])
  status?: number;          // 账号状态: 1-正常 0-封禁

  @IsOptional() @IsDateString()
  startTime?: string;       // 注册开始时间

  @IsOptional() @IsDateString()
  endTime?: string;         // 注册结束时间
}
```

---

## 3. 用户列表 — 动态 WHERE 构建

[`findAll`](apps/api/src/admin/client-user/client-user.service.ts:27) 的核心是动态构建 Prisma `where` 条件：

```typescript
async findAll(query: QueryClientUserDto) {
  const { page, pageSize, phone, userId, kycStatus, startTime, endTime } = query;
  const skip = (page - 1) * pageSize;
  const take = pageSize;

  // 动态构建 WHERE 条件
  const whereConditions: Prisma.UserWhereInput = {};

  if (userId) {
    whereConditions.id = userId;         // 精确匹配
  }
  if (phone) {
    whereConditions.phone = { contains: phone };  // 模糊查询
  }
  if (kycStatus !== undefined) {
    whereConditions.kycStatus = kycStatus;        // 精确匹配
  }
  if (query.status !== undefined) {
    whereConditions.status = query.status;         // 精确匹配
  }
  if (startTime || endTime) {
    whereConditions.createdAt = {};
    if (startTime) whereConditions.createdAt.gte = TimeHelper.toDate(startTime);
    if (endTime) whereConditions.createdAt.lte = TimeHelper.toDate(endTime);
  }

  // $transaction 原子化总条数 + 列表查询
  const [total, users] = await this.prismaService.$transaction([
    this.prismaService.user.count({ where: whereConditions }),
    this.prismaService.user.findMany({
      where: whereConditions,
      skip, take,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, phone: true, nickname: true, avatar: true,
        phoneMd5: true, inviteCode: true, vipLevel: true,
        lastLoginAt: true, kycStatus: true, createdAt: true, status: true,
        wallet: { select: { realBalance: true, coinBalance: true } },  // 关联钱包
      },
    }),
  ]);

  return {
    total,
    list: users.map((user) => ({
      ...user,
      wallet: user.wallet || { realBalance: 0, coinBalance: 0 }, // 无钱包时兜底
    })),
    page, pageSize,
  };
}
```

设计要点：

| 设计 | 说明 |
|------|------|
| **$transaction 包装** | `count` + `findMany` 在同一个事务中执行，保证总数和列表数据一致性 |
| **动态 WHERE** | 仅对非空参数添加条件，避免无效的 WHERE 子句 |
| **选择性 SELECT** | 只返回前端需要的字段（排除敏感字段如 `passwordHash`） |
| **wallet 关联** | 通过 Prisma relation 直接 join 钱包余额，减少 N+1 查询 |
| **钱包兜底** | 用户可能没有初始化钱包（从未充值），前端渲染时返回 `{ realBalance: 0, coinBalance: 0 }` |

---

## 4. 用户详情

[`findOne`](apps/api/src/admin/client-user/client-user.service.ts:113) 通过 `include` 一次性加载关联数据：

```typescript
async findOne(userId: string) {
  const user = await this.prismaService.user.findUnique({
    where: { id: userId },
    include: {
      wallet: true,                              // 钱包完整信息
      devices: { take: 5, orderBy: { lastActiveAt: 'desc' } },  // 最近5个设备
      loginLogs: { take: 5, orderBy: { createdAt: 'desc' } },   // 最近5条登录日志
    },
  });

  if (!user) throw new NotFoundException(`User with ID ${userId} not found`);

  // 获取 enriched devices（含封禁状态）
  const enrichedDevices = await this.getUserDevices(userId);

  return {
    ...user,
    wallet: user.wallet || { realBalance: 0, coinBalance: 0 },
    devices: enrichedDevices.slice(0, 5),  // 用 enriched 数据覆盖原始 devices
  };
}
```

### VO 结构

详情 VO [`ClientUserDetailVo`](apps/api/src/admin/client-user/dto/client-user.dto.ts:222) 继承自列表 VO，扩展了 `devices` 和 `loginLogs`：

```
ClientUserDetailVo
├── id, nickname, phone, status, avatar  (继承自列表)
├── vipLevel, kycStatus, inviteCode       (继承自列表)
├── createdAt, lastLoginAt                 (继承自列表)
├── wallet: { realBalance, coinBalance }   (继承自列表)
├── devices: ClientUserDeviceVo[]          (扩展: 设备列表)
│   └── isBanned, banReason               (设备风控状态)
└── loginLogs: ClientUserLoginVo[]         (扩展: 登录日志)
    └── loginTime, loginIp, loginDevice
```

---

## 5. 设备风控 — DeviceBlacklist

设备管理是用户管理的核心风控功能。系统维护一个 **`DeviceBlacklist` 表**，与 `UserDevice` 表分离。

### 5.1 查询设备列表 + 封禁状态合并

[`getUserDevices`](apps/api/src/admin/client-user/client-user.service.ts:169) 使用**内存匹配**策略：

```typescript
async getUserDevices(userId: string) {
  // 1. 查询用户所有设备
  const devices = await this.prismaService.userDevice.findMany({
    where: { userId },
    orderBy: { lastActiveAt: 'desc' },
  });

  // 2. 收集 deviceId 列表，一次性查黑名单
  const deviceIds = devices.map((d) => d.deviceId);
  const blacklisted = await this.prismaService.deviceBlacklist.findMany({
    where: { deviceId: { in: deviceIds } },
    select: { deviceId: true, reason: true },
  });

  // 3. 内存中合并 isBanned 标记
  const blacklistMap = new Map(
    blacklisted.map((b) => [b.deviceId, b.reason]),
  );

  return devices.map((device) => ({
    ...device,
    isBanned: blacklistMap.has(device.deviceId),
    banReason: blacklistMap.get(device.deviceId) || null,
  }));
}
```

这种 **N+1 → 1+1** 的优化策略：

```
❌ 糟糕的做法（N+1）:
  遍历 devices，对每个 device 查一次 DeviceBlacklist
  → N 次数据库查询

✅ 优化后的做法（1+1）:
  1. 查询 userDevice 获取所有 devices（1 次查询）
  2. 用 deviceId[] IN 条件一次性查询黑名单（1 次查询）
  3. 在内存中用 Map 匹配（0 次查询）
  → 总共 2 次数据库查询
```

### 5.2 拉黑设备

[`banDevice`](apps/api/src/admin/client-user/client-user.service.ts:203) 执行三层操作：

```typescript
async banDevice(dto: BanDeviceDto, adminId: string) {
  const { deviceId, reason } = dto;

  try {
    // Layer 1: 写入 DB 黑名单
    await this.prismaService.deviceBlacklist.create({
      data: { deviceId, reason },
    });

    // Layer 2: 同步 Redis 黑名单集合
    // DeviceSecurityService 的第一道防线
    await this.redisService.sadd('security:device:blacklist', deviceId);

    // Layer 3: 清理缓存，强制下次请求重新校验
    const pattern = `security:device:active:*:${deviceId}`;
    const keys = await this.redisService.keys(pattern);
    if (keys.length > 0) {
      await this.redisService.del(...keys);
    }

    return { success: true };
  } catch (error: any) {
    // 唯一约束冲突：设备已在黑名单中
    if (error.code === 'P2002') {
      // 同步 Redis（防止 DB 已存在但 Redis 未同步的极端情况）
      await this.redisService.sadd('security:device:blacklist', deviceId);
      throw new ConflictException('Device is already banned');
    }
    throw error;
  }
}
```

```
拉黑设备的三层防线:

Redis (内存)           DB (持久化)           缓存 (强制刷新)
─────────              ──────────             ──────────
sadd('security:       deviceBlacklist        del('security:
  device:blacklist',    .create()              device:active:
  deviceId)                                      *:deviceId')

第一道防线:           第二道防线:             第三道防线:
API 请求拦截           持久化存储             强制清除活跃缓存
(毫秒级)               (可靠持久)             (下次请求重新风控)
```

### 5.3 解封设备

[`unbanDevice`](apps/api/src/admin/client-user/client-user.service.ts:239) 是逆操作，但增加了**重置设备绑定历史**的逻辑：

```typescript
async unbanDevice(deviceId: string) {
  try {
    // 1) 从黑名单删除 + 重置该设备的所有绑定记录
    const [, resetBindings] = await this.prismaService.$transaction([
      this.prismaService.deviceBlacklist.delete({
        where: { deviceId },
      }),
      this.prismaService.userDevice.deleteMany({
        where: { deviceId },
      }),
    ]);

    // 2) 从 Redis 黑名单集合中移除
    await this.redisService.srem('security:device:blacklist', deviceId);

    // 3) 清理设备活跃缓存
    const pattern = `security:device:active:*:${deviceId}`;
    const keys = await this.redisService.keys(pattern);
    if (keys.length > 0) {
      await this.redisService.del(...keys);
    }

    return { success: true, resetBindings: resetBindings.count };
  } catch (error: any) {
    if (error.code === 'P2025') {
      throw new NotFoundException('Device is not banned');
    }
    throw error;
  }
}
```

解封时的 `userDevice.deleteMany` 逻辑值得注意：
- 重置设备绑定后，该设备下次登录时会**作为新设备**重新注册
- 账户安全限制（如"同一设备最多绑定 X 个账号"）会从 0 重新计算
- 这对风控场景非常重要：设备被拉黑后，解封时应该给用户一个"干净"的设备状态

---

## 6. 前端 — UserListClient

[`UserListClient`](apps/admin-next/src/components/users/UserListClient.tsx:45) 是用户列表页面的主体组件，使用 `@tanstack/react-table` 构建表格。

### 6.1 数据获取模式

采用 `useQuery` + `staleTime` 模式：

```typescript
const {
  data: usersData,
  isFetching,
  refetch,
} = useQuery({
  queryKey: usersListQueryKey(usersQueryInput),   // 包含搜索参数的 cache key
  queryFn: async () => {
    const res = await clientUserApi.getUsers(
      buildUsersListParams(usersQueryInput),
    );
    return { data: res.list, total: res.total };
  },
  staleTime: 30_000,  // 30秒内不重新请求
});
```

`queryKey` 包含所有搜索参数，确保搜索条件变化时自动重新请求。`staleTime: 30_000` 避免频繁请求。

### 6.2 搜索表单

使用 [`SchemaSearchForm`](apps/admin-next/src/components/scaffold/SchemaSearchForm.tsx) 声明式构建搜索表单（5 个字段）：

```typescript
const searchSchema: FormSchema[] = [
  { type: 'input', key: 'userId', label: '用户ID' },
  { type: 'input', key: 'phone', label: '手机号' },
  { type: 'select', key: 'status', label: '账号状态',
    options: [
      { label: '全部', value: 'ALL' },
      { label: '正常', value: '1' },
      { label: '已冻结', value: '0' },
    ],
  },
  { type: 'select', key: 'kycStatus', label: 'KYC 状态',
    options: [
      { label: '全部', value: 'ALL' },
      ...Object.entries(kycStatusConfig).map(([key, value]) => ({
        label: value.label, value: key,
      })),
    ],
  },
  { type: 'date', key: 'dateRange', label: '注册时间', mode: 'range' },
];
```

### 6.3 表格列定义

表格使用 `@tanstack/react-table` 的 `columnHelper` API 定义 5 列：

| 列 | 类型 | 内容 |
|----|------|------|
| **用户信息** | `display` | 头像 + 昵称 + 手机号 + 封禁水印 |
| **钱包资产** | `display` | 现金余额（绿色）+ 金币余额（橙色） |
| **KYC 等级** | `display` | VIP 等级 Badge + KYC 状态 Badge |
| **注册时间** | `accessor` | UTC 格式时间戳 |
| **操作** | `display` | 查看详情按钮 + 封禁/解冻按钮 |

### 6.4 封禁操作流程

封禁/解冻操作通过 [`ModalManager`](apps/admin-next/src/components/users/UserListClient.tsx:163) 打开确认弹窗：

```typescript
const handleStatusChange = useCallback(async (record: ClientUserListItem) => {
  const isBanning = record.status === 1;
  const targetStatus = isBanning ? 0 : 1;

  ModalManager.open({
    title: isBanning ? '冻结账号' : '恢复账号',
    renderChildren: ({ close }) => (
      <>
        <p>确认{isBanning ? '冻结' : '恢复'}用户 {record.nickname}？</p>
        <textarea placeholder="请输入操作备注（必填）" />
        <Button onClick={async () => {
          await clientUserApi.updateUser(record.id, {
            status: targetStatus,
            remark: remark.trim(),
          });
          await refresh();
          close();
        }}>
          {isBanning ? '确认冻结' : '确认恢复'}
        </Button>
      </>
    ),
  });
}, []);
```

---

## 7. 前端 — UserDetailModal

[`UserDetailModal`](apps/admin-next/src/views/user-management/UserDetailModal.tsx:31) 是用户详情弹窗，采用**左右分栏布局**：

```
┌──────────────────────────────────────────────────┐
│  ┌────────────────────┐  ┌────────────────────┐  │
│  │    Tabs 区域        │  │   侧边栏            │  │
│  │                     │  │                     │  │
│  │  ├─ 概览 (Overview) │  │  头像 + 昵称        │  │
│  │  │  ├─ 余额卡片     │  │  ID + 状态         │  │
│  │  │  └─ 注册信息     │  │  KYC Badge         │  │
│  │  │                   │  │                     │  │
│  │  ├─ 设备 (Devices)  │  │  ─────操作────      │  │
│  │  │  └─ 设备列表     │  │  操作备注输入框      │  │
│  │  │    + 拉黑按钮    │  │  封禁/解冻按钮      │  │
│  │  │                   │  │                     │  │
│  │  └─ 日志 (Logs)     │  │                     │  │
│  │    └─ 登录日志表格  │  │                     │  │
│  └────────────────────┘  └────────────────────┘  │
└──────────────────────────────────────────────────┘
```

### 7.1 数据加载

使用 `useRequest` 钩子：

```typescript
const { data, loading, refresh } = useRequest(() =>
  clientUserApi.getUserById(userId),
);
```

### 7.2 设备管理（在详情弹窗中）

设备列表中的每个设备都显示：
- 设备型号（或"未知型号"）
- 设备指纹 ID（可复制）
- 拉黑原因（如果已拉黑）
- **拉黑/解封按钮**（切换调用 `banDevice` / `unbanDevice`）

```typescript
const { run: toggleDeviceBan } = useRequest(
  async (device: ClientUserDevice) => {
    if (device.isBanned) {
      return clientUserApi.unbanDevice(device.deviceId);
    } else {
      return clientUserApi.banDevice({
        deviceId: device.deviceId,
        reason: 'Admin Manual Ban',
      });
    }
  },
  { manual: true, onSuccess: () => { refresh(); } },
);
```

### 7.3 账号封禁（在详情弹窗中）

右侧边栏底部提供完整的封禁/解冻操作：

```typescript
const handleAccountStatusToggle = () => {
  const isBanning = data?.status === 1;
  const targetStatus = isBanning ? 0 : 1;

  if (isBanning && !remark.trim()) {
    addToast('error', '封禁操作必须填写备注');
    return;
  }

  updateStatus(data!.id, {
    status: targetStatus,
    remark: remark.trim() || undefined,
  });
};
```

---

## 8. 查询与更新流程

### 8.1 用户列表查询

```
admin-next                      API                              PostgreSQL
  │                              │                                  │
  │ GET /admin/client-user/list  │                                  │
  │ ?phone=xxx&status=1          │                                  │
  │ &kycStatus=4                 │                                  │
  │ ────────────────────────────►│                                  │
  │                              │  $transaction([                  │
  │                              │    user.count(where),            │
  │                              │    user.findMany(where +         │
  │                              │      select + wallet join)       │
  │                              │  ])                              │
  │                              │ ────────────────────────────────►│
  │                              │◄── { total, list[] } ───────────│
  │◄── { total, list[] } ──────│                                  │
  │                              │                                  │
```

### 8.2 用户详情

```
admin-next                      API                              PostgreSQL
  │                              │                                  │
  │ GET /admin/client-user/:id   │                                  │
  │ ────────────────────────────►│                                  │
  │                              │  user.findUnique({               │
  │                              │    include: {                    │
  │                              │      wallet,                     │
  │                              │      devices (5),                │
  │                              │      loginLogs (5)               │
  │                              │    }                             │
  │                              │  })                              │
  │                              │ ────────────────────────────────►│
  │                              │◄── user ────────────────────────│
  │                              │                                  │
  │                              │  userDevice.findMany(userId)     │
  │                              │ ────────────────────────────────►│
  │                              │◄── devices[] ───────────────────│
  │                              │                                  │
  │                              │  deviceBlacklist.findMany(       │
  │                              │    deviceId IN [...])            │
  │                              │ ────────────────────────────────►│
  │                              │◄── blacklist[] ─────────────────│
  │                              │                                  │
  │                              │  merge isBanned in memory        │
  │                              │                                  │
  │◄── ClientUserDetailVo ─────│                                  │
```

### 8.3 设备拉黑

```
admin-next                      API                       Redis            PostgreSQL
  │                              │                         │                  │
  │ POST /admin/client-user      │                         │                  │
  │ /device/ban                  │                         │                  │
  │ { deviceId, reason }         │                         │                  │
  │ ────────────────────────────►│                         │                  │
  │                              │  deviceBlacklist.create()│                 │
  │                              │ ──────────────────────────────────────────►│
  │                              │                         │                  │
  │                              │  sadd('security:        │                  │
  │                              │    device:blacklist',    │                  │
  │                              │    deviceId)            │                  │
  │                              │ ──────────────────────► │                  │
  │                              │                         │                  │
  │                              │  keys('security:device: │                  │
  │                              │    active:*:deviceId')  │                  │
  │                              │ ──────────────────────► │                  │
  │                              │◄── keys[] ─────────────│                  │
  │                              │  del(...keys)           │                  │
  │                              │ ──────────────────────► │                  │
  │                              │                         │                  │
  │◄── { success: true } ──────│                         │                  │
```

---

## 9. 安全与性能设计

### 9.1 权限控制

| 端点 | Guard | Permission | 说明 |
|------|-------|------------|------|
| `GET /list` | `PermissionsGuard` | `USER.VIEW` | 所有有查看权限的管理员 |
| `GET /:id` | `PermissionsGuard` | `USER.VIEW` | 查看详情 |
| `PATCH /:id/status` | `PermissionsGuard` | `USER.UPDATE` | 封禁/解冻（敏感操作） |
| `POST /device/ban` | `JwtAuthGuard` 仅 | 无额外限制 | 风控操作 |
| `DELETE /device/unban` | `JwtAuthGuard` 仅 | 无额外限制 | 风控操作 |

### 9.2 数据安全

| 场景 | 措施 |
|------|------|
| **关联数据** | Prisma `select` 精确控制返回字段，避免泄露敏感数据 |
| **密码哈希** | `User` 模型的 `passwordHash` 字段不在列表/详情查询的 `select` 中 |
| **钱包兜底** | 无钱包用户返回 `{ realBalance: 0, coinBalance: 0 }` 而非 null |
| **设备 isBanned** | 不在 DB 中冗余存储，通过运行时内存合并计算 |
| **软删除** | 用户状态 `0` 表示封禁，不物理删除记录 |

### 9.3 性能优化

| 优化 | 说明 |
|------|------|
| **1+1 查询模式** | 设备 + 黑名单分离查询，避免 N+1 |
| **$transaction** | `count` + `findMany` 原子化，保证一致性 |
| **选择性 SELECT** | 只返回前端需要的字段，减少网络传输 |
| **staleTime** | 前端 30 秒缓存，减少重复请求 |
| **Redis 同步** | 设备黑名单 DB + Redis 双重写入（风控场景需要毫秒级响应） |

---

## 10. 总结

客户端用户管理模块展示了 admin 后台中一个典型 CRUD 功能的完整实现，其设计模式可以归纳为：

| 模式 | 应用 | 关键代码 |
|------|------|----------|
| **动态 WHERE 构建** | 根据搜索参数动态组装 Prisma 查询条件 | `if (phone) where.phone = { contains: phone }` |
| **$transaction 原子查询** | 保证 count + findMany 数据一致性 | `this.prisma.$transaction([count, findMany])` |
| **内存合并** | 设备列表与黑名单状态在内存中匹配 | `blacklistMap.has(device.deviceId)` |
| **DB + Redis 双重写入** | 设备拉黑同时写入数据库和缓存 | `deviceBlacklist.create()` + `redis.sadd()` |
| **主动缓存失效** | 拉黑/解封后清理设备活跃缓存 | `redis.keys(pattern)` + `redis.del()` |
| **声明式搜索 Schema** | 前端搜索表单通过 Schema 定义 | `FormSchema[]` 数组驱动渲染 |
| **ModalManager 模式** | 封禁/解冻操作通过 Modal 确认 | `ModalManager.open({ renderChildren })` |
| **分栏详情布局** | Tabs（概览/设备/日志）+ 侧边栏（状态/操作） | `Tabs` + 右侧 `div` 固定宽度 |

### 相关文章

- [`admin-rbac-authorization.md`](docs/blog/articles/admin-next/admin-rbac-authorization.md) — Admin RBAC 权限管理（PermissionsGuard + RequirePermission）
- [`full-stack-kyc-verification.md`](docs/blog/articles/admin-next/full-stack-kyc-verification.md) — KYC 验证体系（KYC 状态流转）
- [`prisma-database-architecture.md`](docs/blog/articles/admin-next/prisma-database-architecture.md) — Prisma 数据库架构设计
- [`register-application-workflow.md`](docs/blog/articles/admin-next/register-application-workflow.md) — 注册申请审批工作流
