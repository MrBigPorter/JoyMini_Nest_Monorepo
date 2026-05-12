# Add Diagnostic Logging for Deposit Webhook

## Problem

After fixing the Invoice V2 routing in `handleUniversalWebhook()`, the deposit webhook still requires manual sync to update order status. The actual Xendit callback payload format reaching our server is unknown.

## Analysis of Manual Sync Log

From the admin manual sync log, Xendit Invoice V2 API returns data in **camelCase** format:

```json
{
  "id": "6a02b021b30934f497e3e9d5",
  "externalId": "DEP20260512044416698641599",
  "status": "PAID",
  "amount": 1000
}
```

This suggests the webhook callback may also use camelCase field names (`externalId`), but our `handleInvoiceWebhook()` at line 105 checks for `payload.external_id` (snake_case) — which would return null if the V2 callback uses different naming.

## Diagnostic Logging Plan

### 1. Add logging at controller entry point

**File**: [`apps/api/src/client/wallet/payment-webhook.controller.ts`](apps/api/src/client/wallet/payment-webhook.controller.ts:24)

Replace `console.log` with structured Logger and log:
- Channel name
- Whether x-callback-token header is present (log length only, not the actual token)
- Full JSON.stringify payload (limited to reasonable depth)

This tells us: **Did Xendit actually send a request to our server?**

### 2. Add logging for token verification failure

**File**: [`apps/api/src/client/wallet/payment-webhook.controller.ts`](apps/api/src/client/wallet/payment-webhook.controller.ts:33)

Log a warning when `verifyCallbackToken()` returns false, before throwing `UnauthorizedException`.

This tells us: **Is the token verification rejecting valid callbacks?**

### 3. Add logging at handleUniversalWebhook entry point

**File**: [`apps/api/src/client/wallet/client-wallet.service.ts`](apps/api/src/client/wallet/client-wallet.service.ts:51)

Log the top-level keys of the payload object to understand the structure.

This tells us: **What format does the actual callback use?**

### 4. Enhanced logging at each routing decision point

**File**: [`apps/api/src/client/wallet/client-wallet.service.ts`](apps/api/src/client/wallet/client-wallet.service.ts)

At the "Unknown Format" fallback (line 92-93), log the full JSON payload.

This tells us: **If nothing matched, what did the payload look like?**

### 5. Logging in handleInvoiceWebhook for field validation

**File**: [`apps/api/src/client/wallet/client-wallet.service.ts`](apps/api/src/client/wallet/client-wallet.service.ts:111)

When `Missing Required Fields` is returned, log what values were actually present (orderNo, status, transactionId values).

This tells us: **If V2 callback uses camelCase fields like `externalId`, we'll see null for orderNo**

## Expected Outcome

After deploying and triggering a deposit, the logs will tell us one of:

| Log Pattern | Meaning |
|---|---|
| No log entries at all | Xendit not sending callback to our URL |
| `[Token] Callback token verification failed` | Token mismatch — need to update XENDIT_CALLBACK_TOKEN |
| `[Webhook] Raw payload keys: event, data, business_id` | Standard V2 format, routing should work |
| `[Webhook] Raw payload keys: external_id, status, amount` | V1 flat format, routing works |
| `[Invoice] Missing fields: orderNo=null, status=PAID` | V2 callback reached but field name is `externalId` not `external_id` |
| `[Webhook Router] Unknown payload format, ignored. Payload: {...}` | Unexpected format we haven't considered |
