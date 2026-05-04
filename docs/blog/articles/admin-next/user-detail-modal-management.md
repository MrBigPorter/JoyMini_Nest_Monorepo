# admin-next 用户管理详情弹窗——UserDetailModal 双栏布局 + Tab 分区 + 设备管控与账号冻结

## 1. 背景

在后台管理系统中，用户详情弹窗是运营人员的核心操作入口。管理员需要在一个页面内完成查看用户基本信息、了解资产状况、管控登录设备、查看登录历史、以及执行账号冻结/解冻等关键操作。

[`UserDetailModal`](apps/admin-next/src/views/user-management/UserDetailModal.tsx:31) 实现了这一需求，采用**左 Tab 内容区 + 右侧边栏**的双栏布局，将 507 行逻辑组织为 1 个主组件 + 3 个内联子组件，覆盖了从数据展示到关键操作的完整闭环。

## 2. 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│  flex-col lg:flex-row (响应式堆叠)                          │
│  ┌───────────────────────────┬─────────────────────────────┐│
│  │ LEFT (flex-1)             │ RIGHT (w-96, 固定宽度)      ││
│  │ bg-slate-50/40            │ bg-white                    ││
│  │                           │                             ││
│  │ TabsList (3 tabs)         │ Avatar (grayscale if frozen)││
│  │ ┌───────────────────────┐ │ nickname + ID badge         ││
│  │ │ Overview:             │ │                             ││
│  │ │  StatCard x2 (余额)   │ │ Account Security section:   ││
│  │ │  DetailItem x4 (身份) │ │  Badge[active/frozen]       ││
│  │ │                       │ │  Badge[KYC verified/pending]││
│  │ │ Devices:              │ │                             ││
│  │ │  Device cards + ban   │ │ Remark textarea             ││
│  │ │                       │ │ Button[freeze/thaw]         ││
│  │ │ Logs:                 │ │                             ││
│  │ │  Login history table  │ │                             ││
│  │ └───────────────────────┘ │                             ││
│  └───────────────────────────┴─────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### 2.1 组件层次

| 层级 | 组件 | 职责 |
|------|------|------|
| 主组件 | [`UserDetailModal`](apps/admin-next/src/views/user-management/UserDetailModal.tsx:31) | 状态管理、API 调用、布局编排 |
| 子组件 | [`EmptyState`](apps/admin-next/src/views/user-management/UserDetailModal.tsx:431) | 空状态占位（虚线边框容器） |
| 子组件 | [`StatCard`](apps/admin-next/src/views/user-management/UserDetailModal.tsx:454) | 统计卡片（标签 + 值 + 图标） |
| 子组件 | [`DetailItem`](apps/admin-next/src/views/user-management/UserDetailModal.tsx:479) | 详情项（标签 + 值 + 可选的复制按钮） |

### 2.2 Props 接口

```typescript
interface Props {
  userId: string;    // 目标用户 ID
  close: () => void; // 关闭弹窗
  reload: () => void; // 刷新父页面列表
  t: TFunc;          // i18n 翻译函数
}
```

## 3. 状态管理

组件使用 3 个独立的 [`useRequest`](apps/admin-next/src/views/user-management/UserDetailModal.tsx:40) 调用管理不同职责：

### 3.1 数据获取

```typescript
const { data, loading, refresh } = useRequest(() =>
  clientUserApi.getUserById(userId),
);
```

- 自动在组件挂载时触发
- `loading` / `data` 驱动渲染
- `refresh` 在设备操作或状态更新后调用

### 3.2 账号状态更新

```typescript
const { run: updateStatus, loading: statusLoading } = useRequest(
  clientUserApi.updateUser,
  {
    manual: true,
    onSuccess: () => {
      addToast('success', t('users_detail_toastStatusUpdated'));
      setRemark('');
      refresh();  // 刷新当前数据
      reload();   // 刷新父页面列表
      close();    // 关闭弹窗
    },
  },
);
```

### 3.3 设备封禁/解封

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
  {
    manual: true,
    onSuccess: () => {
      addToast('success', t('users_detail_toastDeviceUpdated'));
      refresh();  // 仅刷新当前数据，不关闭弹窗
    },
  },
);
```

## 4. 左侧 Tab 内容区

左侧区域使用 [`@repo/ui`](apps/admin-next/src/views/user-management/UserDetailModal.tsx:20) 的 `Tabs` 组件，包含 3 个 Tab：

### 4.1 Overview Tab——资产概览与身份信息

**StatCard 网格**：两个并排的统计卡片，分别展示现金余额和金币余额。

```typescript
<StatCard
  label={t('users_detail_cashBalance')}
  value={`$${data.wallet.realBalance}`}
  icon={<Wallet className="text-emerald-500" size={24} />}
/>
<StatCard
  label={t('users_detail_coinBalance')}
  value={data.wallet.coinBalance}
  icon={<Wallet className="text-amber-500" size={24} />}
/>
```

每个 [`StatCard`](apps/admin-next/src/views/user-management/UserDetailModal.tsx:454) 的结构：
- 左侧：`text-[10px]` 大写标签 + `text-xl font-mono` 粗体数值
- 右侧：圆角图标容器，`group-hover:scale-110` 悬停放大动画

**注册身份区**：4 个 [`DetailItem`](apps/admin-next/src/views/user-management/UserDetailModal.tsx:479) 展示邀请码、VIP 等级、手机号、注册时间。

```typescript
<DetailItem
  label={t('users_detail_inviteCode')}
  value={data.inviteCode}
  copyable
  onCopy={copyToClipboard}
/>
```

[`DetailItem`](apps/admin-next/src/views/user-management/UserDetailModal.tsx:479) 的设计特点：
- `copyable` 属性控制是否显示复制按钮
- 复制按钮 `opacity-0 group-hover/item:opacity-100` 悬停浮现
- 值区域 `group-hover/item:border-slate-100` 悬停边框高亮

### 4.2 Devices Tab——设备管控

每个设备以卡片形式展示：

```typescript
<div className={cn(
  'flex items-center justify-between p-5 rounded-2xl border transition-all group',
  device.isBanned
    ? 'bg-red-50/50 border-red-100'
    : 'bg-white border-slate-100 hover:shadow-md',
)}>
```

**卡片结构**：
1. **左侧**：设备图标（蓝色正常 / 红色封禁）+ 设备型号 + 设备 ID（可复制）+ 封禁原因
2. **右侧**：`Button`（封禁 → 红色 outline / 解封 → primary）

关键设计：
- `device.deviceId` 使用 `truncate max-w-[200px]` 限制宽度
- 复制按钮仅 `group-hover:opacity-100` 显示
- 封禁设备卡片整体红色背景，Badge 显示 `banned` 标签

**空状态**：当无设备时，显示 [`EmptyState`](apps/admin-next/src/views/user-management/UserDetailModal.tsx:431) 组件：

```typescript
<EmptyState
  icon={<Smartphone size={40} />}
  title={t('users_detail_noDevices')}
  description={t('users_detail_noDevicesDesc')}
/>
```

[`EmptyState`](apps/admin-next/src/views/user-management/UserDetailModal.tsx:431) 使用 `border-2 border-dashed` 虚线边框 + `animate-in fade-in zoom-in-95` 入场动画。

### 4.3 Logs Tab——登录日志表格

自定义 HTML `<table>` 实现，三列布局：

| 列 | 渲染方式 | 样式 |
|----|---------|------|
| 时间 | `new Date(log.loginTime).toLocaleString()` | 不加粗，nowrap |
| 位置+IP | IP 在 `bg-slate-100` 圆角 Badge 内，带 `MapPin` 图标 | `font-mono text-center` |
| 设备信息 | `truncate` 限制宽度，`title` 属性悬停查看 | `max-w-[200px]` |

```typescript
<tbody className="divide-y divide-slate-50 dark:divide-slate-800">
  {data.loginLogs.map((log, i) => (
    <tr key={i} className="hover:bg-blue-50/20 transition-colors">
```

空状态：使用 `EmptyState` 以 `History` 图标提示无登录记录。

## 5. 右侧边栏——用户概况与账号操作

右侧边栏固定 `w-96` 宽度，包含三大区域：

### 5.1 头像与身份

```typescript
<div className={cn(
  'h-28 w-28 rounded-[2rem] border-[6px] border-white shadow-2xl overflow-hidden mb-6',
  isFrozen ? 'grayscale opacity-70' : 'rotate-3 hover:rotate-0',
)}>
  <Image fill src={data.avatar || '/default-avatar.png'} ... />
</div>
```

- 头像使用 `next/image` 的 `fill` 模式
- 冻结账号：`grayscale opacity-70` 灰化 + 降低透明度
- 正常账号：`rotate-3 hover:rotate-0` 微倾 + 悬停回正
- 右下角状态图标：冻结时红色背景 `Ban` 图标，正常时蓝色背景 `Shield` 图标

下方显示 `nickname`（`font-black text-2xl`）和 `ID Badge`（`text-[10px] font-mono uppercase`）。

### 5.2 账号安全状态

```typescript
<Badge variant={isFrozen ? 'warning' : 'success'}
  className="w-full justify-center py-2 text-[10px] font-black uppercase">
  {isFrozen ? t('users_detail_accountFrozen') : t('users_detail_accountActive')}
</Badge>
<Badge variant={data.kycStatus === 4 ? 'success' : 'warning'}
  className="w-full justify-center py-2 text-[10px] font-black uppercase">
  {data.kycStatus === 4 ? t('users_detail_kycVerified') : t('users_detail_kycPending')}
</Badge>
```

两个 Badge 覆盖整个宽度，分别展示：
- **账号状态**：Active（`success` 绿色）/ Frozen（`warning` 黄色）
- **KYC 认证**：Verified（`kycStatus === 4`，success 绿色）/ Pending（warning 黄色）

### 5.3 备注输入与冻结/解冻操作

底部操作区包含：

1. **文本域**：`h-24` 高度，`focus:ring-4 focus:ring-red-500/5` 聚焦环动效
2. **操作按钮**：根据当前状态切换文案和变体

```typescript
const handleAccountStatusToggle = () => {
  const isBanning = data?.status === 1;   // status=1 为正常，即将冻结
  const targetStatus = isBanning ? 0 : 1; // 切换目标状态

  if (isBanning && !remark.trim()) {      // 冻结时必须填写备注
    addToast('error', t('users_detail_toastRemarkRequired'));
    return;
  }

  updateStatus(data!.id, {
    status: targetStatus,
    remark: remark.trim() || undefined,
  });
};
```

**业务规则**：
- `status === 1`（正常）→ 点击冻结 → `targetStatus = 0`
- `status === 0`（冻结）→ 点击解冻 → `targetStatus = 1`
- 冻结操作**强制要求**填写备注，否则显示 error toast
- 解冻操作不强制备注

## 6. 设备封禁与复制

### 6.1 设备封禁/解封机制

`toggleDeviceBan` 根据设备当前状态自动选择 API：

```typescript
if (device.isBanned) {
  return clientUserApi.unbanDevice(device.deviceId);
} else {
  return clientUserApi.banDevice({
    deviceId: device.deviceId,
    reason: 'Admin Manual Ban',
  });
}
```

- 封禁原因固定为 `'Admin Manual Ban'`（人工后台封禁标记）
- 操作成功后 `refresh()` 刷新数据但**不关闭弹窗**，管理员可以继续操作其他设备

### 6.2 复制到剪贴板

```typescript
const copyToClipboard = (text: string) => {
  if (!text) return;
  navigator.clipboard.writeText(text);
  addToast('success', t('users_detail_toastCopied'));
};
```

- 使用 `navigator.clipboard.writeText` 浏览器原生 API
- 可复制元素：inviteCode、phone（Overview Tab）、deviceId（Devices Tab）
- 复制成功通过 Toast 反馈

## 7. 加载状态

```typescript
if (loading || !data)
  return (
    <div className="p-20 text-center animate-pulse text-gray-400 flex flex-col items-center gap-3">
      <div className="w-12 h-12 rounded-full border-4 border-slate-100 border-t-blue-500 animate-spin" />
      {t('users_detail_loading')}
    </div>
  );
```

- 使用 `animate-pulse` 整体脉冲动画
- Spinner 通过 `border-t-blue-500 animate-spin` 实现（仅顶部边框有颜色）
- 数据未就绪时**不渲染主内容**，避免空指针

## 8. 与 KYC 审核弹窗的对比

| 维度 | [`UserDetailModal`](apps/admin-next/src/views/user-management/UserDetailModal.tsx:31) | [`KycAuditModal`](apps/admin-next/src/views/kyc/KycAuditModal.tsx:166) |
|------|------|------|
| 布局 | 左 Tab 内容区 + 右侧边栏 | 左证据区 + 右 OCR 比对区 |
| Tab | 3 个（Overview/Devices/Logs） | 无 Tab，垂直滚动 |
| 操作 | 冻结/解冻 + 设备封禁 | APPROVE/REJECT/NEED_MORE |
| 子组件 | EmptyState / StatCard / DetailItem | EvidenceCard / InfoRow / ImagePreviewModal |
| 数据来源 | `clientUserApi.getUserById` | 外部传入 `data` prop |
| 关闭条件 | 冻结后自动关闭 | 审核后自动关闭 |

## 9. 响应式适配

```typescript
<div className="flex flex-col lg:flex-row h-[80vh] w-full ...">
```

- 移动端：上下堆叠（左侧区在上，右侧边栏在下）
- 桌面端（`lg:`）：左右并排
- 左侧区域 `flex-1` 自适应
- 右侧边栏 `w-full lg:w-96` 移动端全宽，桌面端固定 384px

## 10. 设计要点总结

1. **双栏布局分离关注点**：左侧专注信息查看（Tab 切换），右侧专注操作执行（冻结/解冻），互不干扰
2. **乐观 UI 反馈**：设备操作仅 `refresh()` 不关闭弹窗，管理员可连续操作；账号状态更新则关闭弹窗回到列表
3. **安全校验前置**：冻结操作强制备注，防止误操作无法追溯
4. **视觉反馈丰富**：头像灰化、图标颜色切换、Badge 变体、Toast 通知，多通道反馈
5. **子组件内联不耦合**：EmptyState / StatCard / DetailItem 三个子组件与主组件同文件，减少跨文件依赖，保持代码内聚
6. **Loading 屏障**：`loading || !data` 条件阻止空数据渲染，防止 `data.wallet.realBalance` 等链式访问报错

## 11. 完整数据流

```
用户点击详情 → ModalManager.open({ userId })
  → useRequest 自动触发 getUserById
  → loading=true → 显示 spinner
  → loading=false, data 就绪 → 渲染布局
  → 管理员查看信息 / 操作设备 / 冻结账号
  → 设备操作: toggleDeviceBan → refresh()
  → 冻结操作: updateStatus → refresh() + reload() + close()
```

## 12. 总结

[`UserDetailModal`](apps/admin-next/src/views/user-management/UserDetailModal.tsx:31) 是一个典型的"信息展示 + 关键操作"型弹窗。它通过双栏布局将"查看"与"操作"分离，利用 `useRequest` 的 3 次独立调用管理不同职责的数据流，并以内联子组件保持代码内聚。其设计的核心原则是：**让管理员在一个弹窗内完成所有必要操作，无需跳转**。

### 相关文章

- [KYC 审核后台——双栏证据审核与 OCR 比对](kyc-audit-form-system.md)
- [SmartTable——泛型智能表格](smart-table-generic-data-grid.md)
- [UI 组件库——Button、Badge、Tabs 等基础组件](ui-components-library.md)
