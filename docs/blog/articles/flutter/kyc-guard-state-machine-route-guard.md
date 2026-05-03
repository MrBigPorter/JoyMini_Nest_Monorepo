---
title: 'KycGuard: 状态机路由守卫 + KycModal'
slug: kyc-guard-state-machine-route-guard
tags: Flutter, KYC, RouteGuard, StateMachine, Verification
description: 一种路由级守卫，在允许受保护操作之前强制检查 KYC 认证状态，通过三种不同的用户旅程将 KYC 状态机与 UI 层桥接。
---

# KycGuard: 状态机路由守卫 + KycModal

## 1. 背景

[`KycGuard`](JoyMini_Flutter_App/lib/core/guards/kyc_guard.dart) 是一种路由级守卫，在允许需要 KYC 认证的操作之前强制检查 KYC 验证状态。它将 KYC 状态机与 UI 层桥接，根据当前 KYC 状态提供三种不同的用户旅程。

守卫与 [`KycModal`](JoyMini_Flutter_App/lib/components/kyc_modal.dart) 配合，为每种状态呈现适当的 UI。

---

## 2. KYC 状态机

KYC 验证遵循 4 状态生命周期：

```
                    ┌──────────┐
                    │ NotStarted│
                    └────┬─────┘
                         │
                         ▼
                    ┌──────────┐
              ┌─────│ Reviewing│─────┐
              │     └──────────┘     │
              │                      │
              ▼                      ▼
         ┌──────────┐          ┌──────────┐
         │ Approved │          │ Rejected │
         └──────────┘          └────┬─────┘
                                    │
                                    ▼
                               ┌──────────┐
                               │ Reviewing│
                               │ (Resubmit)│
                               └──────────┘
```

这些状态映射到从 `userProvider` 读取的 `KycStatusEnum`：

```dart
// Read from Riverpod provider
final kycStatus = ref.watch(
  userProvider.select((state) => state?.kycStatus)
);
```

---

## 3. 守卫：`KycGuard.ensure()`

守卫接受一个回调，仅在 KYC 通过时触发：

```dart
class KycGuard {
  static void ensure({
    required BuildContext context,
    required VoidCallback onApproved,
  }) {
    final kycStatus = context.read(userProvider)?.kycStatus;
    
    switch (kycStatus) {
      case KycStatusEnum.approved:
        // Verified — execute operation directly
        onApproved();
        break;
        
      case KycStatusEnum.pending:
      case KycStatusEnum.reviewing:
        // Under review — show pending panel
        _showPendingSheet(context);
        break;
        
      case KycStatusEnum.notStarted:
      case KycStatusEnum.rejected:
      default:
        // Needs verification — show KYC modal
        _showVerifyModal(context, onApproved);
        break;
    }
  }
}
```

### 3.1 三种用户旅程

#### 旅程 1：已通过 → 直接执行

当 KYC 已通过时，守卫直接放行：

```dart
case KycStatusEnum.approved:
  onApproved();  // Execute protected operation directly
```

无 UI 中断——用户无缝继续操作。

#### 旅程 2：审核中 → 待审核面板

当 KYC 已提交但正在等待审核时，守卫显示一个非阻塞面板：

```dart
static void _showPendingSheet(BuildContext context) {
  RadixSheet.show(
    context,
    config: ModalSheetConfig(
      title: 'KYC Verification',
      minHeight: 200,
    ),
    builder: (context) => Column(
      children: [
        Icon(Icons.hourglass_empty, size: 48, color: Colors.orange),
        Text('Your KYC is under review'),
        Text('Please wait for the verification result'),
        SizedBox(height: 16),
        ElevatedButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text('OK'),
        ),
      ],
    ),
  );
}
```

这确认了用户的意图，而不会造成令人沮丧的死胡同——他们知道自己的提交正在处理中。

#### 旅程 3：未开始/已拒绝 → 验证弹窗

当 KYC 未完成或被拒绝时，守卫呈现完整的验证弹窗：

```dart
static void _showVerifyModal(
  BuildContext context,
  VoidCallback onApproved,
) {
  RadixModal.show(
    context,
    config: ModalConfig(
      title: 'Identity Verification Required',
    ),
    builder: (context) => Column(
      children: [
        KycModal(),  // Embedded KYC component
        SizedBox(height: 16),
        ElevatedButton(
          onPressed: () {
            Navigator.of(context).pop();
            Navigator.pushNamed(context, '/me/kyc/verify');
          },
          child: Text('Verify Now'),
        ),
      ],
    ),
  );
}
```

---

## 4. KycModal 组件

[`KycModal`](JoyMini_Flutter_App/lib/components/kyc_modal.dart) 是一个可复用的 UI 组件，嵌入在守卫的验证弹窗中。它展示：

- **状态图标**——按 KYC 状态着色（绿色勾选、橙色时钟、红色错误）
- **描述文本**——解释为何需要验证
- **操作按钮**——导航到完整的 KYC 验证流程 `/me/kyc/verify`

---

## 5. 集成点

守卫在应用中所有涉及 KYC 敏感操作的地方使用：

| 操作 | 集成点 | 守卫调用 |
|------|--------|----------|
| 提现 | 钱包 → 提现按钮 | `KycGuard.ensure(context, onApproved: showWithdrawForm)` |
| 高额购买 | 商品详情 → 购买按钮 | `KycGuard.ensure(context, onApproved: placeOrder)` |
| 支付方式变更 | 设置 → 支付方式 | `KycGuard.ensure(context, onApproved: showChannelPicker)` |
| 抽奖奖品领取 | 奖品结果页 | `KycGuard.ensure(context, onApproved: claimPrize)` |

```dart
// Example: Withdraw button handler
onPressed: () => KycGuard.ensure(
  context: context,
  onApproved: () {
    // Only reached when KYC is approved
    Navigator.pushNamed(context, '/wallet/withdraw');
  },
),
```

---

## 6. 错误策略集成

KYC 守卫与 [`UnifiedInterceptor`](unified-interceptor-error-strategy-token-refresh.md) 错误策略系统集成。当后端返回错误码 `93001`（需要 KYC）时，拦截器的 `redirect` 策略触发守卫：

```dart
// In error_config.dart
const _strategyMap = {
  93001: ErrorStrategy.redirect,  // KYC required
};

// In UnifiedInterceptor._handleRedirect
case 93001:
  KycGuard.ensure(
    context: currentContext,
    onApproved: () { /* Retry operation */ },
  );
```

这形成了一个闭环：后端拒绝 → 拦截器检测错误码 → 守卫呈现 KYC 流程 → 用户验证 → 操作重试。

---

## 7. 设计决策

| 决策 | 理由 |
|------|------|
| **静态守卫方法** | 比实例化守卫类更简单——只需调用 `KycGuard.ensure()` |
| **基于回调** | `onApproved` 回调仅在 KYC 就绪时触发，解耦守卫与操作 |
| **待审核用 RadixSheet** | 面板比全屏弹窗对等待状态的侵入性更小 |
| **未验证用 RadixModal** | 弹窗营造适当的紧迫感以完成验证 |
| **已拒绝 = 未开始** | 两种状态都触发验证弹窗——用户重新进入流程，无需过度区分 |

---

## 8. 总结

1. **三种不同的用户旅程**：基于 KYC 状态——已通过（直接放行）、审核中（待审核面板）、未开始/已拒绝（验证弹窗）。
2. **基于回调的守卫**：`onApproved` 仅在 KYC 就绪时触发，保持守卫的通用性和可复用性。
3. **KycModal 组件**：在所有集成点提供可复用的验证 UI。
4. **错误策略集成**：后端 `93001` 错误码通过 `UnifiedInterceptor` 的 redirect 策略触发守卫，形成闭环反馈。
5. **利用现有 RadixSheet/RadixModal 系统**：与应用弹窗架构一致，无需新的 UI 原语。
