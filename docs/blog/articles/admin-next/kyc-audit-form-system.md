---
title: "admin-next KYC 审核系统——KycAuditModal 双栏证据审查 + KycFormModal 身份信息管理"
slug: "kyc-audit-form-system"
date: "2026-05-03"
description: "深入分析 admin-next KYC 模块中审核弹窗的双栏布局、证据卡片 + OCR 数据比对 + 活体检测，以及身份信息表单的创建/编辑双向模式"
tags: ["admin-next", "React", "KYC", "audit", "identity-verification", "lightbox", "evidence-review"]
---

# admin-next KYC 审核系统——KycAuditModal 双栏证据审查 + KycFormModal 身份信息管理

## 1. 背景

KYC（Know Your Customer）是金融级应用的核心合规功能。admin-next 的 KYC 模块包含两个核心组件：[`KycAuditModal`](../../../apps/admin-next/src/views/kyc/KycAuditModal.tsx)（428 行）负责审核员对用户提交的身份证明进行审查和决策；[`KycFormModal`](../../../apps/admin-next/src/views/kyc/KycFormModal.tsx)（198 行）负责管理员手动创建或编辑用户的 KYC 记录。

与之前分析的 [`WithdrawAuditModal`](./finance-audit-withdrawal-adjust-workflow.md) 相比，KYC 审核面临更丰富的数据维度：证件图片、活体视频、OCR 识别数据、活体评分等，因此采用了完全不同的**双栏布局**设计。

## 2. KycAuditModal——审核弹窗

### 2.1 整体布局

审核弹窗采用**左证据 + 右信息**的双栏布局，而非传统的上下结构：

```
┌─────────────────────────────────┬────────────────────────────┐
│  LEFT: Evidence Area (scroll)   │  RIGHT: Sidebar (flex-col) │
│                                 │                            │
│  身份证明文件                    │ 申请人数据 (scroll)         │
│  ┌─────────┐ ┌─────────┐      │  姓名  ───────── OCR 比对  │
│  │ 身份证   │ │ 身份证   │      │  身份证号 ─────── OCR 比对  │
│  │ 正面     │ │ 反面     │      │  生日 ───────── OCR 比对   │
│  └─────────┘ └─────────┘      │  UserID / 手机号          │
│                                 │  提交时间                   │
│  生物识别验证                    │  ┌──────────────────────┐  │
│  ┌─────────┐ ┌─────────┐      │  │ 风险提示（OCR 不匹配） │  │
│  │ 活体     │ │ 活体     │      │  └──────────────────────┘  │
│  │ 照片     │ │ 视频     │      │                            │
│  └─────────┘ └─────────┘      │  DECISION (Sticky Footer)  │
│                                 │  ┌──────────────────────┐  │
│                                 │  │ Remark Textarea      │  │
│                                 │  ├──────────────────────┤  │
│                                 │  │ [✕] [?] [✓ ✓]      │  │
│                                 │  └──────────────────────┘  │
└─────────────────────────────────┴────────────────────────────┘
```

### 2.2 EvidenceCard——证据卡片

[`EvidenceCard`](../../../apps-admin-next/src/views/kyc/KycAuditModal.tsx:70) 是一个精致的图片展示组件，用于展示身份证正反面和活体照片：

```typescript
const EvidenceCard = ({ title, src, onPreview, t }) => (
  <div className="group relative bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-all">
    {/* Header */}
    <div className="px-3 py-2 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
      <span className="text-xs font-semibold text-gray-600">{title}</span>
      {src && (
        <Maximize2 size={14}
          className="text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity"
        />
      )}
    </div>
    {/* Image Area */}
    <div className="relative aspect-video bg-gray-100 dark:bg-black/20">
      {src ? (
        <div className="w-full h-full cursor-zoom-in" onClick={() => onPreview(src, title)}>
          <Image src={src} alt={title} width={600} height={400}
            layout="constrained" className="w-full h-full object-contain"
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors pointer-events-none" />
        </div>
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center text-gray-400 gap-1">
          <ScanText size={24} className="opacity-20" />
          <span className="text-[10px]">{t('kyc_noImage')}</span>
        </div>
      )}
    </div>
  </div>
);
```

设计细节：
- `aspect-video` 保持 16:9 比例
- `group-hover:opacity-100` 悬停时显示最大化图标，提示可点击放大
- `cursor-zoom-in` 鼠标样式提示图片可缩放
- 无图片时显示 `ScanText` 图标 + "无图片" 占位提示
- 图片使用 [`Image`](https://unpic.dev/) 组件（`@unpic/react`），`layout="constrained"` 确保响应式

### 2.3 ImagePreviewModal——大图预览

[`ImagePreviewModal`](../../../apps-admin-next/src/views/kyc/KycAuditModal.tsx:32) 是一个轻量级 Lightbox 实现：

```typescript
const ImagePreviewModal = ({ src, title, onClose }) => {
  if (!src) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <button onClick={onClose} className="absolute top-6 right-6 text-white/70 hover:text-white">
        <X size={32} />
      </button>
      <div className="max-w-full max-h-full flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
        <img src={src} alt={title}
          className="max-w-[90vw] max-h-[85vh] object-contain rounded shadow-2xl"
        />
        <p className="text-white/90 mt-3 text-lg font-medium">{title}</p>
      </div>
    </div>
  );
};
```

技术要点：
- 使用原生 `<img>` 而非 `@unpic/react` 的 `<Image>`，因为 Lightbox 中图片尺寸在运行时未知
- `z-[100]` 极高 z-index 确保覆盖所有弹窗层级
- 背景点击关闭 + 内容区域 `stopPropagation` 防止误关
- `animate-in fade-in duration-200` 淡入动画

### 2.4 InfoRow——数据比对行

[`InfoRow`](../../../apps-admin-next/src/views/kyc/KycAuditModal.tsx:124) 是右侧信息区的核心组件，它不仅能展示数据，还能进行 **OCR 比对**：

```typescript
const InfoRow = ({ label, value, subValue, highlight = false, t }) => (
  <div className="py-3 border-b border-gray-100 dark:border-white/5 last:border-0">
    <div className="flex justify-between items-center mb-1">
      <span className="text-xs text-gray-500">{label}</span>
      {subValue && (
        <span className={cn(
          'text-[10px] font-mono px-1.5 py-0.5 rounded border',
          value !== subValue
            ? 'bg-amber-50 text-amber-700 border-amber-100'
            : 'bg-green-50 text-green-700 border-green-100',
        )}>
          {t('kyc_ocrLabel')}: {subValue}
        </span>
      )}
    </div>
    <div className={cn(
      'text-sm break-all',
      highlight ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300',
    )}>
      {value || '-'}
    </div>
  </div>
);
```

**OCR 比对逻辑**：
- `subValue`（OCR 识别值）与 `value`（用户提交值）比较
- 匹配时：绿色标签（`bg-green-50 text-green-700`）
- 不匹配时：琥珀色标签（`bg-amber-50 text-amber-700`）
- 无 OCR 数据时不显示标签

这种设计让审核员**一眼识别**用户提交数据与 OCR 识别的差异。

### 2.5 活体检测区

活体检测区展示活体照片和 liveness 视频，附带**评分标签**：

```typescript
{data.livenessScore !== undefined && (
  <span className={cn(
    'text-[10px] px-1.5 rounded font-bold',
    data.livenessScore > 90
      ? 'bg-green-100 text-green-700'
      : 'bg-amber-100 text-amber-700',
  )}>
    {t('kyc_scoreLabel')}: {data.livenessScore.toFixed(0)}
  </span>
)}
```

评分阈值：**> 90 分为绿色（通过）**，否则为琥珀色（需人工判断）。

视频播放使用原生 `<video>` 标签：

```typescript
{data.videoUrl ? (
  <video src={data.videoUrl} controls className="w-full h-full object-contain" />
) : (
  <div className="flex flex-col items-center text-gray-500 gap-1">
    <Video size={24} className="opacity-30" />
    <span className="text-[10px]">{t('kyc_noVideo')}</span>
  </div>
)}
```

### 2.6 风险提示

当 OCR 识别身份证号与用户提交的不一致时，出现**红色风险提示框**：

```typescript
{ocrData.idNumber && data.idNumber !== ocrData.idNumber && (
  <div className="mt-6 p-3 bg-red-50 border border-red-100 rounded-lg text-red-700 text-xs flex gap-2">
    <AlertTriangle size={16} className="shrink-0" />
    <div>
      <strong>{t('kyc_riskAlert')}:</strong> {t('kyc_idMismatch')}
    </div>
  </div>
)}
```

### 2.7 审核决策流程

审核决策区域根据 `data.kycStatus` 分为两种状态：

#### 审核中（`isReviewing = true`）

显示**三个操作按钮**：

```typescript
<div className="grid grid-cols-4 gap-3">
  <Button variant="danger" className="col-span-1" size="sm"
    disabled={!remark} onClick={() => handleAudit('REJECT')}>
    <XCircle size={18} />
  </Button>
  <Button variant="outline" className="col-span-1 border-amber-300 text-amber-600"
    size="sm" disabled={!remark} onClick={() => handleAudit('NEED_MORE')}>
    ?
  </Button>
  <Button variant="primary" className="col-span-2 shadow-sm" size="sm"
    onClick={() => handleAudit('APPROVE')}>
    <CheckCircle2 size={16} className="mr-2" /> {t('kyc_approve')}
  </Button>
</div>
```

三种审核动作：
| 动作 | 按钮 | 备注要求 | 说明 |
|------|------|---------|------|
| `APPROVE` | 绿色主按钮，占 2/3 宽度 | 不需要 | 通过审核 |
| `REJECT` | 红色危险按钮，1/3 宽度 | 必须填写 | 拒绝 |
| `NEED_MORE` | 琥珀色描边按钮，1/3 宽度 | 必须填写 | 要求补充材料 |

**备注验证**：拒绝和要求补充必须填写备注，通过 `handleAudit` 函数控制：

```typescript
const handleAudit = (action: 'APPROVE' | 'REJECT' | 'NEED_MORE') => {
  if (!remark && action !== 'APPROVE') {
    return addToast('error', t('kyc_remarkRequired'));
  }
  submitAudit(data.id, { action, remark });
};
```

#### 已审核（非 `isReviewing`）

显示**只读状态标识**：

```typescript
<div className={cn(
  'flex items-center justify-center gap-2 p-3 rounded-lg font-bold border text-sm',
  data.kycStatus === KYC_STATUS.APPROVED
    ? 'bg-green-50 text-green-700 border-green-200'
    : 'bg-red-50 text-red-700 border-red-200',
)}>
  {data.kycStatus === KYC_STATUS.APPROVED ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
  <span>{t('kyc_currentStatus')}: {t(`kyc_status_${...}`)}</span>
</div>
```

审核员备注框在非审核状态下显示已有的 `auditResult` 或 `rejectReason`，`disabled` 不可编辑。

### 2.8 组件的编辑/查看模式自动切换

KycAuditModal 根据 `data.kycStatus` 自动判断模式：
- `KYC_STATUS.REVIEWING` → 编辑模式（显示操作按钮、可编辑备注）
- 其他状态 → 查看模式（只读状态标识、只读备注）

这种设计使得**一个组件同时承担审核和查看两个角色**，无需拆分。

## 3. KycFormModal——KYC 信息表单

[`KycFormModal`](../../../apps-admin-next/src/views/kyc/KycFormModal.tsx:41) 是一个相对简洁的表单组件，用于管理员手动创建或编辑用户的 KYC 记录。

### 3.1 组件 Props

```typescript
interface Props {
  mode: 'create' | 'edit';
  initialData?: KycRecord;
  close: () => void;
  reload: () => void;
  t: TFunc;
}
```

使用 `mode` prop 而非 `editingData` 的有无来判断模式，这是一个更明确的设计选择。

### 3.2 Zod Schema 函数工厂

Schema 使用**函数工厂模式**支持国际化错误消息：

```typescript
const createKycFormSchema = (t: (key: string) => string) =>
  z.object({
    userId: z.string().min(1, t('kyc_validation_userIdRequired')),
    realName: z.string().min(1, t('kyc_validation_realNameRequired')),
    idNumber: z.string().min(1, t('kyc_validation_idNumberRequired')),
    idType: z.coerce.number(),
    remark: z.string().optional(),
  });

type KycFormInput = z.infer<ReturnType<typeof createKycFormSchema>>;
```

`z.coerce.number()` 用于将 select 组件的字符串值转为数字，适配 `idType` 的数字枚举。

### 3.3 编辑模式特殊处理

编辑模式下，`userId` 字段被禁用且显示蓝色提示：

```typescript
<FormTextField
  name="userId"
  label={t('kyc_formUserId')}
  required={true}
  disabled={isEdit}
/>
{isEdit && (
  <p className="text-xs text-blue-600 mt-2 flex items-center gap-1">
    ⓘ {t('kyc_formUserIdDisabledHint')}
  </p>
)}
```

编辑时 remark 字段被重置为空：

```typescript
form.reset({
  userId: initialData.userId,
  realName: initialData.realName || '',
  idNumber: initialData.idNumber || '',
  idType: initialData.idType || 1,
  remark: '', // 修改时备注通常置空，让管理员填新的原因
});
```

### 3.4 创建 vs 编辑的 API 差异

```typescript
if (isEdit) {
  return kycApi.updateInfo(formData.userId, {
    realName: formData.realName,
    idNumber: formData.idNumber,
    idType: formData.idType,
    remark: formData.remark,
  });
} else {
  return kycApi.create({
    userId: formData.userId,
    realName: formData.realName,
    idNumber: formData.idNumber,
    idType: formData.idType,
    remark: formData.remark,
  });
}
```

注意 `updateInfo` 的 userId 通过 URL path 传递（第一个参数），`create` 的 userId 在 body 中。

### 3.5 表单布局

```
KycFormModal
├── Container (flex-col, h-full)
│   ├── Scrollable Content
│   │   ├── User ID (蓝色背景容器)
│   │   │   └── userId (编辑模式 disabled + 提示)
│   │   ├── 2-Column Grid
│   │   │   ├── realName (text)
│   │   │   └── idType (select: KycIdTypesList)
│   │   ├── idNumber (text, full width)
│   │   └── remark (textarea, full width)
│   └── Footer (border-top, flex-end)
│       ├── Cancel (ghost)
│       └── Save/Create (primary)
```

- `userId` 独占一行置于蓝色背景容器中，强调其重要性
- 表单宽度约束 `max-w-2xl mx-auto`
- 隐藏的 `<button type="submit">` 支持回车键提交

## 4. 设计模式总结

### 4.1 审核弹窗 vs 提现审核弹窗对比

| 特性 | KycAuditModal | WithdrawAuditModal |
|------|--------------|-------------------|
| 布局 | 双栏（证据 + 信息） | 单栏（信息 + 操作） |
| 审核动作 | APPROVE / REJECT / NEED_MORE | SUCCESS / REJECTED |
| 二次确认 | 无 | 仅 APPROVE 需要 |
| 多媒体 | 图片 + 视频 | 无 |
| OCR 比对 | 有（颜色编码） | 无 |
| 备注要求 | REJECT / NEED_MORE 必须 | 推荐填写 |
| 状态自动检测 | `data.kycStatus === REVIEWING` | `data.withdrawStatus === PENDING_AUDIT` |

### 4.2 四种信息比对策略

KycAuditModal 通过颜色编码实现了四种信息比对：

| 组件 | 比对内容 | 匹配颜色 | 不匹配颜色 |
|------|---------|---------|-----------|
| InfoRow (subValue) | 用户提交 vs OCR | 绿色标签 | 琥珀色标签 |
| 风险提示框 | 身份证号比对 | 不显示 | 红色警告 |
| 活体评分 | 评分阈值 90 | 绿色 | 琥珀色 |
| 状态标识 | 已审核结果 | 绿色 | 红色 |

### 4.3 两种表单创建/编辑模式

| 特性 | BannerFormModal | CouponModal | KycFormModal |
|------|----------------|-------------|-------------|
| 模式识别 | `editingData` 有无 | `editingData?.issuedQuantity` | `mode` prop |
| 字段锁定 | 无锁定 | 已发放优惠券 | userId 编辑锁定 |
| 数据转换 | `form.reset` + Date 转换 | 双向 transformer | `form.reset` 直接映射 |

## 5. 总结

KYC 审核系统展示了审核类弹窗的另一种架构可能。与 [`WithdrawAuditModal`](./finance-audit-withdrawal-adjust-workflow.md) 的简洁单栏布局不同，`KycAuditModal` 的双栏布局和丰富的多媒体证据展示面向的是**信息密集型审核场景**——审核员需要同时查看证件图片、比对 OCR 数据、观看活体视频并做出决策。

`KycFormModal` 则采用更简洁的表单设计，通过 `mode: 'create' | 'edit'` 的明确 prop 区分工作模式，保持了与 [`BannerFormModal`](./banner-management-form-modal.md) 和 [`CouponModal`](./coupon-marketing-system.md) 一致的 `react-hook-form` + Zod 技术栈。

### 相关文章

- [`finance-audit-withdrawal-adjust-workflow.md`](./finance-audit-withdrawal-adjust-workflow.md) — 提现审核工作流对比
- [`banner-management-form-modal.md`](./banner-management-form-modal.md) — Banner 表单的条件渲染
- [`coupon-marketing-system.md`](./coupon-marketing-system.md) — 优惠券表单的字段锁定
- [`ui-components-library.md`](./ui-components-library.md) — Button / FormTextField / FormSelectField 等基础组件
