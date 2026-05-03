# Blog Translation Failure — V4 Root Cause Analysis & Fix Plan

## 1. Why V3 Failed

V3's core assumption was wrong: **KEY_429_COOLDOWN = 60s is too short**.

### Retry Storm Death Spiral

```
14:06:54 — First 429 on key OO0u → blocked 60s → wait 59s
14:07:53 — Wait ends, key still ~600ms from recovery → returns null
         → ai.service.ts throws Error → processor handleRateLimit()
         → NOT recognized as rate-limit → only waits 1s!
         → Retries with still-blocked/unrecovered key → 429 AGAIN
         → Each retry generates MORE 429 requests to Groq
14:13:57 — 7 MINUTES LATER: ALL 4 keys, RPM=0 → ALL still 429!!!
```

### Key Evidence from Logs

```log
14:13:57 🔑 Groq selected key ...XfeN (index 0, RPM 0)   ← RPM=0 means NO requests in 60s!
14:13:57 ⚠️ Groq key ...XfeN hit 429, blocking for 60s      ← Still 429 after 7+ minutes idle!
```

**RPM=0 but still 429.** This means:
- The rate limit is NOT RPM-based (or not just RPM-based)
- Groq's cooldown for this account is **>7 minutes**
- Every retry generates a new 429 which MAY reset rate limit clock
- The 4 keys share ONE Groq account — trying them sequentially is pointless

## 2. Chain of Errors

| Layer | What happens | Problem |
|-------|-------------|---------|
| `groq.provider.ts` | 429 → wait 59s → retry | `blockedUntil` offset by ~600ms → retry misses window |
| `groq.provider.ts` | Returns null after wait | Waste 59s on blocked wait |
| `ai.service.ts:717` | Throws Error on null | Error message is `"Translation failed: AI returned null..."` — no rate-limit signal |
| `handleRateLimit()` | Checks `error.code===429` or message includes 'Too Many Requests' | **MISSES** the rate-limit detection → uses 1s non-rate-limit delay |
| Processor retries | 1s/2s/3s delays | Way too short for Groq recovery |
| Retry → Groq | New API call → 429 again | **Resets rate limit clock!** |

## 3. Fix Plan

### Fix 1: Read Groq's `Retry-After` Header

```typescript
// In 429 catch block:
const retryAfter = e.response?.headers?.['retry-after'];
const cooldownMs = retryAfter 
  ? parseInt(retryAfter, 10) * 1000    // Use server's suggestion
  : 120000;                              // Fallback: 2 minutes
```

### Fix 2: Block ALL Keys on First 429 (Shared Account)

When any Groq key gets 429, **all** keys share the same account rate limit. Block them all immediately.

```typescript
// Block ALL Groq keys when any key 429s
const cooldownUntil = Date.now() + cooldownMs;
for (const key of this.keyInstances) {
  key.blocked = true;
  key.blockedReason = 'rate_limited';
  key.blockedUntil = cooldownUntil;
}
```

### Fix 3: Remove Wait-for-Recovery Inside `generateText()`

The current 59s wait inside `generateText()` (V3 lines 194-205) is harmful because:
1. It holds the CPU thread for 59 seconds
2. It may miss the recovery window by a few hundred ms
3. The processor's `handleRateLimit()` is designed to handle retry timing

Instead: **Return null immediately** on 429 after blocking all keys. Let the processor handle retry timing with proper backoff.

### Fix 4: Propagate 429 Signal to `ai.service.ts`

When the Groq provider returns null due to rate limiting, `ai.service.ts` should throw an error that `handleRateLimit()` can recognize.

Option A: Throw an error with code 429
```typescript
if (!result) {
  const err = new Error(`Groq rate limited, all keys blocked`);
  (err as any).code = 429;
  throw err;
}
```

Option B: Check provider availability before calling `generateText()`
```typescript
if (!this.groqProvider.isAvailable()) {
  throw Object.assign(new Error('Groq rate limited'), { code: 429 });
}
```

### Fix 5: Update `handleRateLimit()` to Use Provider's `blockedUntil`

The processor's `handleRateLimit()` currently uses fixed delays (5s/15s/30s). Instead, it should:

```typescript
// Check if Groq provider has a blockedUntil timestamp
const groqCooldown = this.aiService.getGroqCooldownRemaining();
if (groqCooldown > 0) {
  const delay = Math.min(groqCooldown + 1000, 120000); // Wait for key + 1s buffer
  await new Promise(resolve => setTimeout(resolve, delay));
}
```

## 4. Files to Modify

| File | Changes |
|------|---------|
| [`groq.provider.ts`](apps/api/src/common/ai/providers/groq.provider.ts) | 1. Read `Retry-After` header<br>2. Block ALL keys on first 429<br>3. Remove wait-for-recovery (return null immediately)<br>4. Export `getMinBlockedWaitTime()` or add `getGlobalBlockedUntil()` |
| [`ai.service.ts`](apps/api/src/common/ai/ai.service.ts) | 1. Detect rate-limit from provider and throw with `code: 429`<br>2. Add `getGroqCooldownRemaining()` method |
| [`blog-ai.processor.ts`](apps/api/src/common/ai/ai.service.ts) | 1. Update `handleRateLimit()` to check provider cooldown before fixed delays |

## 5. Expected Behavior After Fix

```
First request → Groq 429
  → Read Retry-After header (or default 120s)
  → Block ALL 4 Groq keys for 120s
  → Return null (caught by ai.service.ts)
  → Throw error with code: 429
  → handleRateLimit(): sees code 429, uses 5s/15s/30s backoff
  → After retry delay, Groq keys still blocked (120s) → isAvailable() returns false
  → Processor waits full retry delay (30s × max retries) then fails job
  → **No additional Groq requests generated = no rate limit clock reset**
```

## 6. Key Insight

**The retry storm IS the problem.** By retrying Groq at all (even with 60s waits), we generate additional 429 requests that keep the rate limit active. The fix is to **immediately stop retrying Groq on first 429** and let the global retry mechanism handle timing.
