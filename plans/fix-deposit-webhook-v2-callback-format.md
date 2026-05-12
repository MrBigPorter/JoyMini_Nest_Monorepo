# Fix: Deposit Webhook Not Auto-Pushing (Xendit Invoice V2 Callback Format)

## Root Cause Analysis

### The Bug

In [`handleUniversalWebhook()`](apps/api/src/client/wallet/client-wallet.service.ts:51-79), the webhook routing logic only handles two known formats:

1. **Payout V2** (line 61): Checks `payload.event.startsWith('payout.')` → passes `payload.data` to [`handlePayoutWebhook()`](apps/api/src/client/wallet/client-wallet.service.ts:201) ✅
2. **Invoice V1 (flat)** (line 69): Checks `typeof payload.external_id === 'string'` → passes full `payload` to [`handleInvoiceWebhook()`](apps/api/src/client/wallet/client-wallet.service.ts:85) ✅
3. **Everything else** (line 77): Silently ignored with `{ status: 'IGNORED', reason: 'Unknown Format' }` ❌

### Why It Breaks

Xendit's **Invoice V2 API** sends webhook callbacks in this format:

```json
{
  "event": "invoice.paid",
  "data": {
    "id": "inv_...",
    "external_id": "DEP20260512...",
    "status": "PAID",
    "amount": 100.00
  }
}
```

Since `payload.external_id` is `undefined` (it's nested inside `payload.data`), the condition at line 69 fails, and the webhook falls through to the **ignored** branch at line 77.

### Why Payout Works But Invoice Doesn't

The payout handler (line 61-66) **already handles V2 format** by checking `payload.event` for the `payout.` prefix and extracting `payload.data`. The invoice handler was never updated to do the same — it still only checks for flat V1 format (`payload.external_id` at the top level).

### Why Manual Sync Works

The admin's [`syncRechargeStatus()`](apps/api/src/admin/finance/finance.service.ts:526-655) queries Xendit's API directly via [`getInvoiceById()`](apps/api/src/common/payment/payment.service.ts:131) or [`getInvoiceByExternalId()`](apps/api/src/common/payment/payment.service.ts:146), completely bypassing the callback format parsing. This is why manual sync in the admin panel succeeds.

### Why Orders Eventually Process

The cron task [`handleStuckOrders()`](apps/api/src/admin/finance/finance.task.ts:29-84) runs every **10 minutes** and auto-syncs orders older than **30 minutes** via the same `syncRechargeStatus()` API query approach. This creates a **30+ minute delay** for what should be instant webhook processing.

## Fix Strategy

### Target File
[`apps/api/src/client/wallet/client-wallet.service.ts`](apps/api/src/client/wallet/client-wallet.service.ts)

### Change 1: Add Invoice V2 Detection in `handleUniversalWebhook()`

**Location**: Between line 66 and line 68 (after the payout check, before the V1 invoice check).

Add a new detection branch for Invoice V2 format:

```typescript
// 判定逻辑 2: Invoice V2 (Xendit Invoice V2 API 回调)
// 依据：event 字段以 'invoice.' 开头，数据在 payload.data 中
if (event && event.startsWith('invoice.')) {
  this.logger.log(
    `[Webhook Router] Identified as INVOICE V2 (Event: ${event})`,
  );
  if (isRecord(payload.data)) {
    return this.handleInvoiceWebhook(payload.data);
  }
  this.logger.warn(`[Webhook Router] INVOICE V2 event without data, ignored.`);
  return { status: 'IGNORED', reason: 'Missing data field' };
}
```

### No Changes Needed Elsewhere

- [`handleInvoiceWebhook()`](apps/api/src/client/wallet/client-wallet.service.ts:85-195) already handles the flat payload format correctly (extracts `external_id`, `status`, `amount`, `id` from the top-level object). Since we pass `payload.data` which is the flat invoice object, this method works as-is.
- Database idempotency (line 128-140, `updateMany` with `rechargeStatus: PENDING` check) is already correct.
- The `isRecord()` helper function (line 26) already exists and is used in the method.
- No changes to the controller, CSRF middleware, or response interceptor are needed — the webhook endpoint already accepts `any` payload type.

## Verification Steps

1. **Type-check**: Run `yarn workspace @lucky/api type-check` to verify no TypeScript errors.
2. **Lint**: Run `yarn workspace @lucky/api lint` to verify no linting errors.
3. **Manual test**: Simulate a V2 callback payload:
   ```json
   {
     "event": "invoice.paid",
     "data": {
       "id": "inv_test123",
       "external_id": "DEP202605120001",
       "status": "PAID",
       "amount": 100.00
     }
   }
   ```
   Send to `POST /api/v1/payment/webhook/xendit` and verify the order status updates correctly.

## Files Changed

| File | Change |
|------|--------|
| [`apps/api/src/client/wallet/client-wallet.service.ts`](apps/api/src/client/wallet/client-wallet.service.ts) | Add Invoice V2 detection branch in `handleUniversalWebhook()` (lines 67-72, between payout check and V1 invoice check) |

## Why This Approach

1. **Minimal change**: Only ~10 lines added to one file.
2. **Pattern consistency**: Mirrors the existing payout V2 handler exactly.
3. **Backward compatible**: V1 format (`payload.external_id`) still works for any systems still sending flat format.
4. **No risk to existing logic**: The new branch only activates when `payload.event` starts with `invoice.`, which cannot conflict with existing checks.
5. **No new dependencies**: Uses existing `isRecord()` helper and [`handleInvoiceWebhook()`](apps/api/src/client/wallet/client-wallet.service.ts:85) method.
