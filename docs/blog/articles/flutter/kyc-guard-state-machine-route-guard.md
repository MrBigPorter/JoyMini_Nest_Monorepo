---
title: "KycGuard: State Machine Route Guard + KycModal"
slug: kyc-guard-state-machine-route-guard
tags: Flutter, KYC, RouteGuard, StateMachine, Verification
description: A route-level guard that enforces KYC verification state before allowing protected operations, bridging the KYC state machine with UI layers via three distinct user journeys.
---

# KycGuard: State Machine Route Guard + KycModal

## Overview

[`KycGuard`](JoyMini_Flutter_App/lib/core/guards/kyc_guard.dart) is a route-level guard that enforces KYC verification state before allowing operations that require KYC authentication. It bridges the KYC state machine with the UI layer, providing three distinct user journeys based on the current KYC status.

The guard works with [`KycModal`](JoyMini_Flutter_App/lib/components/kyc_modal.dart) to present the appropriate UI for each state.

---

## 1. KYC State Machine

KYC verification follows a 4-state lifecycle:

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

These states map to `KycStatusEnum` read from `userProvider`:

```dart
// Read from Riverpod provider
final kycStatus = ref.watch(
  userProvider.select((state) => state?.kycStatus)
);
```

---

## 2. Guard: `KycGuard.ensure()`

The guard accepts a callback that fires only when KYC is approved:

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

### Three User Journeys

#### Journey 1: Approved → Direct Execution

When KYC is already approved, the guard passes through directly:

```dart
case KycStatusEnum.approved:
  onApproved();  // Execute protected operation directly
```

No UI interruption — the user proceeds seamlessly.

#### Journey 2: Under Review → Pending Panel

When KYC has been submitted but is awaiting review, the guard shows a non-blocking panel:

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

This acknowledges the user's intent without creating a frustrating dead-end — they know their submission is being processed.

#### Journey 3: Not Started / Rejected → Verification Modal

When KYC is incomplete or rejected, the guard presents the full verification modal:

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

## 3. KycModal Component

[`KycModal`](JoyMini_Flutter_App/lib/components/kyc_modal.dart) is a reusable UI component embedded in the guard's verification modal. It displays:

- **Status icon** — colored by KYC state (green check, orange clock, red error)
- **Description text** — explaining why verification is needed
- **Action button** — navigating to the full KYC verification flow `/me/kyc/verify`

---

## 4. Integration Points

The guard is used throughout the app wherever KYC-sensitive operations occur:

| Operation | Integration Point | Guard Invocation |
|-----------|-----------------|------------|
| Withdraw | Wallet → Withdraw button | `KycGuard.ensure(context, onApproved: showWithdrawForm)` |
| High-value purchase | Product detail → Buy button | `KycGuard.ensure(context, onApproved: placeOrder)` |
| Payment method change | Settings → Payment methods | `KycGuard.ensure(context, onApproved: showChannelPicker)` |
| Lucky draw prize claim | Prize result page | `KycGuard.ensure(context, onApproved: claimPrize)` |

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

## 5. Error Strategy Integration

The KYC guard integrates with the [`UnifiedInterceptor`](unified-interceptor-error-strategy-token-refresh.md) error strategy system. When the backend returns error code `93001` (KYC required), the interceptor's `redirect` strategy triggers the guard:

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

This creates a closed loop: backend rejects → interceptor detects error code → guard presents KYC flow → user verifies → operation retried.

---

## 6. Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Static guard method** | Simpler than instantiating a guard class — just call `KycGuard.ensure()` |
| **Callback-based** | `onApproved` callback fires only when KYC is ready, decoupling guard from operation |
| **RadixSheet for pending** | Panel is less intrusive than a full-screen modal for waiting states |
| **RadixModal for unverified** | Modal creates appropriate urgency to complete verification |
| **Rejected = NotStarted** | Both states trigger the verification modal — user re-enters flow without over-distinction |

---

## Key Takeaways

1. **Three distinct user journeys** based on KYC status — Approved (direct pass-through), Reviewing (pending panel), NotStarted/Rejected (verification modal).
2. **Callback-based guard** — `onApproved` fires only when KYC is ready, keeping the guard generic and reusable.
3. **KycModal component** provides reusable verification UI across all integration points.
4. **Error strategy integration** — backend `93001` error code triggers the guard via `UnifiedInterceptor`'s redirect strategy, creating a closed feedback loop.
5. **Leverages existing RadixSheet/RadixModal system** — consistent with the app's modal architecture without new UI primitives.
