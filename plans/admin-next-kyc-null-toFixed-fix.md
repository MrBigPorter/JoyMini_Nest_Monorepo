# Bug Fix Plan: Admin KYC Modal Cannot Open When No Image Uploaded

## Bug Description

When opening a KYC audit record where the user **has not uploaded images** (no ID photos, no face image, no liveness video), the audit modal crashes with:

```
Uncaught TypeError: Cannot read properties of null (reading 'toFixed')
```

This prevents the audit modal from opening at all, making it impossible for admins to view or process KYC records that lack uploaded media.

## Root Cause Analysis

**File:** [`apps/admin-next/src/views/kyc/KycAuditModal.tsx`](apps/admin-next/src/views/kyc/KycAuditModal.tsx)

**Line 245-254 — Faulty null guard:**

```tsx
{data.livenessScore !== undefined && (       // line 245 — ❌ only guards against undefined
  <span ...>
    {tAction('kyc_scoreLabel')}: {data.livenessScore.toFixed(0)}  // line 254 — 💥 null.toFixed(0)
  </span>
)}
```

### The JavaScript subtlety:

| Expression | Result |
|---|---|
| `null !== undefined` | `true` |
| `null == undefined` | `true` |

The guard `data.livenessScore !== undefined` uses strict inequality (`!==`), which **does NOT treat `null` the same as `undefined`**. When the API returns `livenessScore: null` (which happens when no liveness data exists), the condition evaluates to `true`, execution enters the block, and `null.toFixed(0)` throws:

> `TypeError: Cannot read properties of null (reading 'toFixed')`

Since this is a **render-time error** in React, the entire component crashes before it can be displayed, resulting in an unopenable modal.

**Type definition:** [`apps/admin-next/src/type/types.ts:688`](apps/admin-next/src/type/types.ts:688)

```ts
livenessScore?: number; // 0-100 分数
```

The `?` type annotation means `number | undefined`, but at runtime the API can return `null` (JSON `null` deserializes to JavaScript `null`, not `undefined`).

## The Fix

**Change line 245** from:

```tsx
{data.livenessScore !== undefined && (
```

to:

```tsx
{data.livenessScore != null && (
```

Using loose inequality (`!=`) correctly catches both `null` and `undefined`:

- `null != null` → `false` ✅ (skips, no crash)
- `undefined != null` → `false` (technically `undefined == null` is `true`, so `undefined != null` is `false`) ✅
- `95 != null` → `true` ✅ (renders score)

## Files to Modify

| File | Change |
|---|---|
| [`apps/admin-next/src/views/kyc/KycAuditModal.tsx:245`](apps/admin-next/src/views/kyc/KycAuditModal.tsx:245) | `data.livenessScore !== undefined` → `data.livenessScore != null` |

## Verification

1. Open a KYC record where the user has not uploaded any images (API returns `livenessScore: null`)
2. ✅ The audit modal should open and render, showing "No Image" placeholders for missing evidence
3. ✅ Open a KYC record with uploaded images and a valid `livenessScore` (e.g., `95`)
4. ✅ The score badge should still display correctly: `Score: 95`
