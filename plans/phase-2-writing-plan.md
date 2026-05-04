# Phase 2 写作计划 — admin-next 页面深度 + 跨项目集成（已完成 ✅）

> **状态：全部完成** 🏆
>
> 基于 [`writing-progress-analysis.md`](writing-progress-analysis.md)，Phase 1（64 篇计划）已于 2026-05-03 全部完成（98%，功能 100%）。
> 以下为 Phase 2 扩展写作计划执行记录，所有文章已于 **2026-05-03** 同日完成。
>
> 本文档已存档。最新进度请参见 [`writing-progress-analysis.md`](writing-progress-analysis.md#七phase-2-跨项目集成文章--已完成-)。

---

## 阶段一：admin-next 页面级深度文章（8 篇 ✅）

> 源码均在当前仓库 `apps/admin-next/src/views/`，可直接读取。

执行结果：

| # | 文章主题 | 核心源码 | 文章 | 状态 |
|---|---------|---------|------|------|
| B1 | 财务审核工作流 — 提现审核 + 手动调账 | [`finance/WithdrawalList.tsx`](../apps/admin-next/src/views/finance/WithdrawalList.tsx) + [`WithdrawAuditModal.tsx`](../apps/admin-next/src/views/finance/WithdrawAuditModal.tsx) + [`ManualAdjustModal.tsx`](../apps/admin-next/src/views/finance/ManualAdjustModal.tsx) | [`finance-audit-withdrawal-adjust-workflow.md`](../docs/blog/articles/admin-next/finance-audit-withdrawal-adjust-workflow.md) | ✅ |
| B2 | 交易流水追踪 — 充值列表 + 交易列表 + 详情弹窗 | [`finance/DepositList.tsx`](../apps/admin-next/src/views/finance/DepositList.tsx) + [`TransactionList.tsx`](../apps/admin-next/src/views/finance/TransactionList.tsx) + [`DepositDetailModal.tsx`](../apps/admin-next/src/views/finance/DepositDetailModal.tsx) + [`TransactionDetailModal.tsx`](../apps/admin-next/src/views/finance/TransactionDetailModal.tsx) | [`finance-deposit-transaction-tracking.md`](../docs/blog/articles/admin-next/finance-deposit-transaction-tracking.md) | ✅ |
| B3 | Banner 管理 — 表单 + 商品绑定 | [`banner/BannerFormModal.tsx`](../apps/admin-next/src/views/banner/BannerFormModal.tsx) + [`BannerBindProduct.tsx`](../apps/admin-next/src/views/banner/BannerBindProduct.tsx) | [`banner-management-form-modal.md`](../docs/blog/articles/admin-next/banner-management-form-modal.md) | ✅ |
| B4 | 优惠券营销系统 | [`Marketing/Coupon.tsx`](../apps/admin-next/src/views/Marketing/Coupon.tsx) + [`CouponModal.tsx`](../apps/admin-next/src/views/Marketing/CouponModal.tsx) | [`coupon-marketing-system.md`](../docs/blog/articles/admin-next/coupon-marketing-system.md) | ✅ |
| B5 | KYC 审核后台 | [`kyc/KycAuditModal.tsx`](../apps/admin-next/src/views/kyc/KycAuditModal.tsx) + [`KycFormModal.tsx`](../apps/admin-next/src/views/kyc/KycFormModal.tsx) | [`kyc-audit-form-system.md`](../docs/blog/articles/admin-next/kyc-audit-form-system.md) | ✅ |
| B6 | 用户管理详情弹窗 | [`user-management/UserDetailModal.tsx`](../apps/admin-next/src/views/user-management/UserDetailModal.tsx) | [`user-detail-modal-management.md`](../docs/blog/articles/admin-next/user-detail-modal-management.md) | ✅ |
| B7 | 商品 CRUD — 创建 + 编辑表单 | [`product/CreateProductFormModal.tsx`](../apps/admin-next/src/views/product/CreateProductFormModal.tsx) + [`EditProductFormModal.tsx`](../apps/admin-next/src/views/product/EditProductFormModal.tsx) | [`product-crud-create-edit-form.md`](../docs/blog/articles/admin-next/product-crud-create-edit-form.md) | ✅ |
| B8 | 限时抢购 + 活动专区产品绑定 | [`flash-sale/FlashSaleBindProductModal.tsx`](../apps/admin-next/src/views/flash-sale/FlashSaleBindProductModal.tsx) + [`act-section/ActSectionBindProductModal.tsx`](../apps/admin-next/src/views/act-section/ActSectionBindProductModal.tsx) | [`flash-sale-act-section-bind-product.md`](../docs/blog/articles/admin-next/flash-sale-act-section-bind-product.md) | ✅ |

---

## 阶段二：跨项目全栈集成文章（5 篇 ✅）

> 需要跨仓库读取 API + Flutter 源码。

执行结果：

| # | 文章主题 | 涉及项目 | 核心源码 | 文章 | 状态 |
|---|---------|---------|---------|------|------|
| C1 | 端到端推送通知 — API FCM → Flutter FCM → admin-next | API + Flutter + admin-next | 多文件 | [`end-to-end-push-notification.md`](../docs/blog/articles/admin-next/end-to-end-push-notification.md) | ✅ |
| C2 | 全栈 KYC — API KYC Provider → Flutter KycGuard → Admin KYC | API + Flutter + admin-next | 多文件 | [`full-stack-kyc-verification.md`](../docs/blog/articles/admin-next/full-stack-kyc-verification.md) | ✅ |
| C3 | 全栈认证 — API JWT → Flutter AuthNotifier → admin-next Middleware | API + Flutter + admin-next | 多文件 | [`full-stack-authentication.md`](../docs/blog/articles/admin-next/full-stack-authentication.md) | ✅ |
| C4 | 文件上传管道 — API Upload → Flutter GlobalUploadService | API + Flutter + admin-next | 多文件 | [`full-stack-file-upload.md`](../docs/blog/articles/admin-next/full-stack-file-upload.md) | ✅ |
| C5 | 支付流程全链路 — API Xendit → admin-next 财务审核 | API + admin-next | 多文件 | [`payment-full-chain-xendit.md`](../docs/blog/articles/admin-next/payment-full-chain-xendit.md) | ✅ |

---

## 阶段三：计划文档归档（✅ 已完成）

- ✅ 本计划文档已标记为 **已完成**
- ✅ [`writing-progress-analysis.md`](writing-progress-analysis.md) 已添加 Phase 2 完整章节
- ✅ Phase 1 标记为 **完成** ✅
- ✅ Phase 2 全部 13 篇文章已产出

---

## 文章规格

（执行中严格遵循）[`ARTICLE_AUTHORING_STANDARD.md`](../docs/blog/development/ARTICLE_AUTHORING_STANDARD.md) v2.0.0：

- 中文正文，英文代码注释
- YAML frontmatter（title / description / slug / tags / date）
- 1 级标题 `# 文章名` 开头
- 2 级标题 `## N. 章节名` 格式
- 代码块必须标注语言
