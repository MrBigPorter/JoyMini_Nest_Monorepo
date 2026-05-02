# KycGuard：状态机路由守卫 + KycModal

> **目标读者：** Flutter 移动端工程师
> **标签：** `#Flutter` `#KYC` `#RouteGuard` `#StateMachine` `#Verification`
> **难度：** 中级
> **预计阅读时间：** 10 分钟

---

## 概述

[`KycGuard`](JoyMini_Flutter_App/lib/core/guards/kyc_guard.dart) 是一个路由级守卫，在执行需要 KYC 认证的操作之前强制检查用户的 KYC 认证状态。它将 KYC 状态机与 UI 层桥接起来，根据当前 KYC 状态提供三种不同的用户旅程。

该守卫与 [`KycModal`](JoyMini_Flutter_App/lib/components/kyc_modal.dart) 配合使用，为每种状态呈现适当的 UI。

---

## 1. KYC 状态机

KYC 认证遵循 4 状态生命周期：

```
                    ┌──────────┐
                    │  未开始   │
                    └────┬─────┘
                         │
                         ▼
                    ┌──────────┐
             ┌─────│  审核中   │─────┐
             │     └──────────┘     │
             │                      │
             ▼                      ▼
        ┌──────────┐          ┌──────────┐
        │  已通过   │          │  已拒绝   │
        └──────────┘          └────┬─────┘
                                   │
                                   ▼
                              ┌──────────┐
                              │  审核中   │
                              │ (重新提交)│
                              └──────────┘
```

这些状态映射到从 `userProvider` 读取的 `KycStatusEnum`：

```dart
// 从 Riverpod provider 读取
final kycStatus = ref.watch(
  userProvider.select((state) => state?.kycStatus)
);
```

---

## 2. 守卫：`KycGuard.ensure()`

守卫接受一个回调，仅在 KYC 已通过时执行：

```dart
class KycGuard {
  static void ensure({
    required BuildContext context,
    required VoidCallback onApproved,
  }) {
    final kycStatus = context.read(userProvider)?.kycStatus;
    
    switch (kycStatus) {
      case KycStatusEnum.approved:
        // 已验证通过 — 直接执行操作
        onApproved();
        break;
        
      case KycStatusEnum.pending:
      case KycStatusEnum.reviewing:
        // 审核中 — 显示等待中面板
        _showPendingSheet(context);
        break;
        
      case KycStatusEnum.notStarted:
      case KycStatusEnum.rejected:
      default:
        // 需要认证 — 显示 KYC 模态框
        _showVerifyModal(context, onApproved);
        break;
    }
  }
}
```

### 三种用户旅程

#### 旅程 1：已通过 → 直接执行

当 KYC 已通过时，守卫直接放行：

```dart
case KycStatusEnum.approved:
  onApproved();  // 直接执行受保护的操作
```

无 UI 中断——用户无缝继续其操作。

#### 旅程 2：审核中 → 等待面板

当 KYC 已提交但正在等待审核时，守卫显示一个非阻塞面板：

```dart
static void _showPendingSheet(BuildContext context) {
  RadixSheet.show(
    context,
    config: ModalSheetConfig(
      title: 'KYC 认证',
      minHeight: 200,
    ),
    builder: (context) => Column(
      children: [
        Icon(Icons.hourglass_empty, size: 48, color: Colors.orange),
        Text('您的 KYC 正在审核中'),
        Text('请等待认证结果'),
        SizedBox(height: 16),
        ElevatedButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text('好的'),
        ),
      ],
    ),
  );
}
```

这确认了用户的操作意图，而不会造成令人沮丧的死胡同——他们知道自己的提交正在处理中。

#### 旅程 3：未开始/已拒绝 → 认证模态框

当 KYC 未完成或已被拒绝时，守卫呈现完整的认证模态框：

```dart
static void _showVerifyModal(
  BuildContext context,
  VoidCallback onApproved,
) {
  RadixModal.show(
    context,
    config: ModalConfig(
      title: '需要身份认证',
    ),
    builder: (context) => Column(
      children: [
        KycModal(),  // 嵌入式 KYC 组件
        SizedBox(height: 16),
        ElevatedButton(
          onPressed: () {
            Navigator.of(context).pop();
            Navigator.pushNamed(context, '/me/kyc/verify');
          },
          child: Text('立即认证'),
        ),
      ],
    ),
  );
}
```

---

## 3. KycModal 组件

[`KycModal`](JoyMini_Flutter_App/lib/components/kyc_modal.dart) 是嵌入在守卫认证模态框中的可复用 UI 组件。它展示：

- **状态图标** — 根据 KYC 状态着色（绿色勾、橙色时钟、红色错误）
- **描述文字** — 说明为什么需要认证
- **操作按钮** — 导航到完整的 KYC 认证流程 `/me/kyc/verify`

---

## 4. 集成点

守卫在整个应用中凡是涉及 KYC 敏感操作的地方被使用：

| 操作 | 集成点 | 守卫调用 |
|-----------|-----------------|------------|
| 提现 | 钱包 → 提现按钮 | `KycGuard.ensure(context, onApproved: showWithdrawForm)` |
| 高价值购买 | 商品详情 → 购买按钮 | `KycGuard.ensure(context, onApproved: placeOrder)` |
| 支付渠道变更 | 设置 → 支付方式 | `KycGuard.ensure(context, onApproved: showChannelPicker)` |
| 抽奖领奖 | 奖品结果页面 | `KycGuard.ensure(context, onApproved: claimPrize)` |

```dart
// 示例：提现按钮处理
onPressed: () => KycGuard.ensure(
  context: context,
  onApproved: () {
    // 只有 KYC 已通过时才会到达这里
    Navigator.pushNamed(context, '/wallet/withdraw');
  },
),
```

---

## 5. 错误策略集成

KYC 守卫与 [`UnifiedInterceptor`](unified-interceptor-error-strategy-token-refresh.md) 的错误策略系统集成。当后端返回错误码 `93001`（需要 KYC）时，拦截器的 `redirect` 策略会触发：

```dart
// 在 error_config.dart 中
const _strategyMap = {
  93001: ErrorStrategy.redirect,  // 需要 KYC
};

// 在 UnifiedInterceptor._handleRedirect 中
case 93001:
  KycGuard.ensure(
    context: currentContext,
    onApproved: () { /* 重试操作 */ },
  );
```

这形成了一个闭环：后端拒绝 → 拦截器检测到错误码 → 守卫展示 KYC 流程 → 用户认证 → 操作重试。

---

## 6. 设计决策

| 决策 | 理由 |
|----------|-----------|
| **静态守卫方法** | 比实例化守卫类更简单——只需调用 `KycGuard.ensure()` |
| **基于回调** | `onApproved` 回调仅在 KYC 就绪时执行，将守卫与操作解耦 |
| **审核中使用 RadixSheet** | 等待状态下，面板比全屏模态框侵入性更小 |
| **未开始时使用 RadixModal** | 模态框营造完成认证的适当紧迫感 |
| **已拒绝 = 未开始** | 两种状态都触发认证模态框——用户重新进入流程，无需过多区分 |

---

## 关键要点

1. **三种不同的用户旅程**，基于 KYC 状态——已通过（直接放行）、审核中（等待面板）、未开始/已拒绝（认证模态框）。
2. **基于回调的守卫**——`onApproved` 仅在 KYC 就绪时触发，保持守卫通用且可复用。
3. **KycModal 组件**在所有集成点提供可复用的认证 UI。
4. **错误策略集成**——后端的 `93001` 错误码通过 `UnifiedInterceptor` 的重定向策略触发守卫，形成闭环反馈。
5. **使用现有的 RadixSheet/RadixModal 系统**——与应用模态架构一致，无需新的 UI 原语。
