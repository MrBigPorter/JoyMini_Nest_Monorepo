# Blog AI Translation Failure — Root Cause Analysis & Fix Plan (V2)

## 1. Problem Summary

The AI-powered article translation pipeline is failing when translating Chinese articles to Korean (`ko`). All jobs get stuck in a retry storm that rate-limits all Groq API keys.

## 2. Root Cause Analysis

### 2.1 Immediate Cause: Rate Limiting (429), NOT Token Exhaustion

From the admin dashboard:

| Groq Key | Used Tokens | Limit | Status |
|----------|------------|-------|--------|
| #1 | **0k** / 500k | ⛔ BLOCKED |
| #2 | **2k** / 500k | ⛔ BLOCKED |
| #3 | **11k** / 500k | ✅ Normal |
| #4 | **6k** / 500k | ⛔ BLOCKED |

**Total used: ~19k tokens** out of 2M daily limit. Keys are blocked by **HTTP 429 rate limiting**, not token exhaustion.

### 2.2 The Retry Storm: 12 API Calls Per Article

```
Per article:
  1. batchTranslateArticle → 3 calls (all 429)
  2. fallbackToTraditionalTranslation:
     - translateWithRetry(title) → 3 calls  
     - translateWithRetry(content) → 3 calls
     - translateWithRetry(excerpt) → 3 calls
   = 12 API calls in <5 seconds → all keys 429'd
```

**Rate math**: Groq free tier ~30 RPM per key × 4 keys = 120 RPM total capacity.
12 calls in 5 seconds = equivalent to 144 RPM → **exceeds total capacity**.

### 2.3 Key Selection Problem: Round-Robin Is Not Rate-Aware

Current [`rotateToNextKey()`](apps/api/src/common/ai/providers/groq.provider.ts:184) simply picks the next non-blocked key in sequence. It does NOT consider:
- How many requests each key has made recently
- Whether a key is approaching its RPM limit
- Spreading load evenly across keys

### 2.4 No Inter-Request Delay Within a Single Job

[`batchTranslateArticle()`](apps/api/src/blog/processors/blog-ai.processor.ts:229) makes 3 rapid retry attempts with only reactive backoff (wait AFTER 429), no proactive delay.
[`fallbackToTraditionalTranslation()`](apps/api/src/blog/processors/blog-ai.processor.ts:540) fires 3 sequential `translateWithRetry()` calls with no delay between them.

### 2.5 Critical Bug: `translateText()` Silently Returns Original Text

At [`ai.service.ts:717`](apps/api/src/common/ai/ai.service.ts:717):
```typescript
return result || text;
```
When AI returns `null`, this returns original Chinese text, triggering wasteful retries and extra API calls.

### 2.6 Error Cascade

```mermaid
flowchart TD
    A[Trigger translate-article job] --> B[batchTranslateArticle: attempt 1]
    B --> C[429 rate limited]
    C --> D[batchTranslateArticle: attempt 2]
    D --> E[429 rate limited]
    E --> F[batchTranslateArticle: attempt 3]  
    F --> G[429 rate limited]
    G --> H[fallbackToTraditionalTranslation]
    H --> I[translateWithRetry title x3]
    I --> J[translateWithRetry content x3]
    J --> K[translateWithRetry excerpt x3]
    K --> L[12 calls in <5 seconds]
    L --> M[All 4 keys 429 blocked for 60s]
    M --> N[Job FAILED - all keys exhausted]
    
    O[rotateToNextKey: round-robin, no RPM awareness] --> M
    P[No inter-request delay in processor] --> L
    Q[translateText: return result || text] --> R[AI null -> returns original -> wasteful retries]
```

## 3. Solution: Frequency-Based Rate Control

### 3.1 Design Philosophy

Instead of reacting to rate limits (waiting after 429), **prevent rate limits proactively** by:
1. Tracking per-key request frequency in a rolling 60-second window
2. Selecting the least-loaded key before each API call
3. Adding inter-request delays to smooth out traffic bursts

### 3.2 Per-Key RPM Tracking (Groq Provider)

Add to [`GroqKeyState`](apps/api/src/common/ai/providers/groq.provider.ts:11):
```typescript
interface GroqKeyState {
  // ... existing fields ...
  requestTimestamps: number[];  // timestamps of requests in rolling 60s window
}
```

New helper methods:
```typescript
private readonly RPM_LIMIT = 30;  // Groq free tier: 30 requests/min per key
private readonly RPM_WINDOW_MS = 60000;  // 60-second rolling window

private pruneStaleTimestamps(key: GroqKeyState): void {
  const cutoff = Date.now() - this.RPM_WINDOW_MS;
  key.requestTimestamps = key.requestTimestamps.filter(t => t > cutoff);
}

private getCurrentRpm(key: GroqKeyState): number {
  this.pruneStaleTimestamps(key);
  return key.requestTimestamps.length;
}
```

### 3.3 Smart Key Selection: Replace `rotateToNextKey()`

Replace [`rotateToNextKey()`](apps/api/src/common/ai/providers/groq.provider.ts:184) with `selectBestKey()`:

```typescript
selectBestKey(): boolean {
  const totalKeys = this.keyInstances.length;
  if (totalKeys === 0) return false;

  // Prune stale timestamps on all keys first
  for (const key of this.keyInstances) {
    this.pruneStaleTimestamps(key);
  }

  // Score each key: lower RPM = better
  let bestIndex = -1;
  let bestRpm = Infinity;

  for (let i = 0; i < totalKeys; i++) {
    const key = this.keyInstances[i];
    
    // Skip blocked or daily-exhausted keys
    if (key.blocked) continue;
    if (key.dailyTokens >= this.DAILY_LIMIT) continue;
    
    const rpm = key.requestTimestamps.length;
    if (rpm < bestRpm) {
      bestRpm = rpm;
      bestIndex = i;
    }
  }

  if (bestIndex >= 0 && bestRpm < this.RPM_LIMIT) {
    this.activeKeyIndex = bestIndex;
    return true;
  }

  // All keys at RPM limit → calculate wait time for the soonest-available key
  if (bestIndex >= 0) {
    const soonestKey = this.keyInstances[bestIndex];
    const oldestTimestamp = soonestKey.requestTimestamps[0]; // exits window soonest
    const waitMs = oldestTimestamp + this.RPM_WINDOW_MS - Date.now() + 100;
    this.logger.warn(
      `All keys at RPM limit, need to wait ~${Math.ceil(waitMs / 1000)}s for key ...${soonestKey.keySuffix}`
    );
    // This info can be used by the caller to delay
  }

  this.logger.warn(`🛑 All ${totalKeys} Groq keys at rate limit`);
  return false;
}
```

### 3.4 Proactive Delay in `generateText()`

In [`generateText()`](apps/api/src/common/ai/providers/groq.provider.ts:83), before the API call:

```typescript
// Proactive rate check: select best key based on RPM
if (!this.selectBestKey()) {
  // All keys at limit → wait for the soonest available slot
  const minWait = this.getMinWaitTime();
  if (minWait > 0 && minWait < 30000) {  // only wait if reasonable
    this.logger.warn(`Rate limit approaching, waiting ${minWait}ms before retry`);
    await new Promise(resolve => setTimeout(resolve, minWait));
    // Retry selection after wait
    if (!this.selectBestKey()) return null;
  } else {
    return null;
  }
}

// Record the request timestamp
const currentKey = this.keyInstances[this.activeKeyIndex];
currentKey.requestTimestamps.push(Date.now());

// ... make API call ...
```

### 3.5 Inter-Request Delay in Processor

Add to [`blog-ai.processor.ts`](apps/api/src/blog/processors/blog-ai.processor.ts):

```typescript
private readonly interRequestDelay = 500; // 500ms between API calls

private async delayBetweenRequests(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, this.interRequestDelay));
}
```

Apply in:
- [`batchTranslateArticle()`](apps/api/src/blog/processors/blog-ai.processor.ts:229) — delay between retry attempts (after `handleRateLimit`)
- [`fallbackToTraditionalTranslation()`](apps/api/src/blog/processors/blog-ai.processor.ts:540) — delay between title/content/excerpt calls
- [`translateWithRetry()`](apps/api/src/blog/processors/blog-ai.processor.ts:130) — delay between retry attempts

## 4. Complete Fix List

### Critical (Must Fix)

| # | Priority | File | Change |
|---|----------|------|--------|
| 1 | **Critical** | [`groq.provider.ts:11`](apps/api/src/common/ai/providers/groq.provider.ts:11) | Add `requestTimestamps[]` to `GroqKeyState` interface |
| 2 | **Critical** | [`groq.provider.ts:184`](apps/api/src/common/ai/providers/groq.provider.ts:184) | Replace `rotateToNextKey()` with `selectBestKey()` — RPM-aware selection |
| 3 | **Critical** | [`groq.provider.ts:83`](apps/api/src/common/ai/providers/groq.provider.ts:83) | Add proactive rate check + timestamp recording in `generateText()` |
| 4 | **Critical** | [`groq.provider.ts:238`](apps/api/src/common/ai/providers/groq.provider.ts:238) | Expose RPM stats in `getUsageStats()` |
| 5 | **Critical** | [`ai.service.ts:717`](apps/api/src/common/ai/ai.service.ts:717) | `translateText()` throw on null instead of `result \|\| text` |

### High Priority

| # | Priority | File | Change |
|---|----------|------|--------|
| 6 | **High** | [`blog-ai.processor.ts:540`](apps/api/src/blog/processors/blog-ai.processor.ts:540) | Add inter-request delay in `fallbackToTraditionalTranslation()` |
| 7 | **High** | [`blog-ai.processor.ts:229`](apps/api/src/blog/processors/blog-ai.processor.ts:229) | Add inter-request delay in `batchTranslateArticle()` retry loop |
| 8 | **High** | [`blog-ai.processor.ts:130`](apps/api/src/blog/processors/blog-ai.processor.ts:130) | Add inter-request delay in `translateWithRetry()` retry loop |
| 9 | **High** | [`groq.provider.ts:38`](apps/api/src/common/ai/providers/groq.provider.ts:38) | Add `RPM_LIMIT` and `RPM_WINDOW_MS` constants |
| 10 | **High** | [`groq.provider.ts:214`](apps/api/src/common/ai/providers/groq.provider.ts:214) | Reset `requestTimestamps` in `resetDailyCounters()` |

## 5. Rate Analysis: Why This Works

### Without fix (current behavior):
```
batchTranslateArticle:  [0s] call 1 → 429      [1s] call 2 → 429      [2s] call 3 → 429
fallback title:         [2.5s] call 4 → 429     [3s] call 5 → 429      [3.5s] call 6 → 429
fallback content:       [4s] call 7 → 429       [4.5s] call 8 → 429    [5s] call 9 → 429
fallback excerpt:       [5s] call 10 → 429      [5.5s] call 11 → 429   [6s] call 12 → 429
→ All 4 keys blocked for 60s after ~5 seconds
```

### With fix (proactive rate control + delays):
```
batchTranslateArticle:  [0s] call 1 → key#1     [0.5s] delay
                        [0.5s] call 2 → key#2   [0.5s] delay
                        [1s] call 3 → key#3     [0.5s] delay
fallback title:         [1.5s] call 4 → key#4   [0.5s] delay
                        [2s] call 5 → key#1     [0.5s] delay
                        [2.5s] call 6 → key#2   [0.5s] delay
fallback content:       [3s] call 7 → key#3     [0.5s] delay
                        [3.5s] call 8 → key#4   [0.5s] delay
                        [4s] call 9 → key#1     [0.5s] delay
fallback excerpt:       [4.5s] call 10 → key#2  [0.5s] delay
                        [5s] call 11 → key#3    [0.5s] delay
                        [5.5s] call 12 → key#4
→ ~3 RPM per key over 60s window → well within 30 RPM limit → ✅ No 429
```

### Why Gemini/DeepSeek Unaffected
The frequency-based fixes are entirely within the Groq provider and processor layers. The `strict` mode in [`ai.service.ts`](apps/api/src/common/ai/ai.service.ts) remains unchanged — no fallback to other providers occurs. The system respects the user's configured provider choice at all times.

## 6. Key Insight

The root cause is a **three-layer problem**:
1. **No RPM tracking** — keys are selected blindly without knowing their current request rate
2. **No inter-request delay** — 12 calls fire in <5 seconds, overwhelming the 120 RPM total capacity
3. **Silent data return** in `translateText()` that wastes retries

**Fixing #1 (RPM-aware key selection) and #2 (inter-request delay) prevent rate limiting entirely** — the system proactively stays within rate limits instead of reactively recovering from 429 errors. This preserves the user's configured provider preference without any automatic degradation.
