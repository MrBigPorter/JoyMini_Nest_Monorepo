# Plan: Sync GroqProvider V2-V4 Modifications to Documentation

## Overview

Sync the V2 (RPM-aware key selection), V3 (wait-for-recovery), and V4 (break retry storm) modifications made to [`groq.provider.ts`](apps/api/src/common/ai/providers/groq.provider.ts), [`ai.service.ts`](apps/api/src/common/ai/ai.service.ts), [`blog-ai.processor.ts`](apps/api/src/blog/processors/blog-ai.processor.ts), and [`ai-provider.interface.ts`](apps/api/src/common/ai/interfaces/ai-provider.interface.ts) into the three existing documentation articles.

---

## Article 1: `docs/blog/articles/api/ai-service-multi-provider-abstraction-layer.md`

### Change 1.1 — AiKeyInstance: Add `requestTimestamps` field (Section 3, lines 138-149)

The interface definition at line 140-148 currently lacks the `requestTimestamps` field (used internally by `GroqKeyState`). Add a note explaining that the internal state also tracks per-key RPM via a rolling 60-second window.

**Current:**
```typescript
export interface AiKeyInstance {
  keySuffix: string;
  dailyTokens: number;
  dailyRequests: number;
  blocked: boolean;
  blockedReason: string | null;
  blockedUntil: number;
}
```

**Action:** Add a paragraph after the code block explaining that `GroqProvider`'s internal `GroqKeyState` extends this with `requestTimestamps: number[]` for RPM tracking. (The public interface stays unchanged.)

### Change 1.2 — AiProviderUsageStats: Add `currentRpm` and `rpmLimit` (Section 3, lines 151-169)

The stats interface now includes optional `currentRpm` and `rpmLimit` fields in the keys array.

**Current:**
```typescript
keys: {
  index: number;
  keySuffix: string;
  dailyTokens: number;
  dailyRequests: number;
  dailyLimit: number;
  blocked: boolean;
  blockedReason: string | null;
  isActive: boolean;
}[];
```

**Action:** Add `currentRpm?: number` and `rpmLimit?: number` to the keys item type.

### Change 1.3 — GroqProvider section: Update description and code (Section 4.2, lines 206-231)

Multiple updates needed:

| Item | Current | Updated |
|------|---------|---------|
| File line count (line 208) | `groq.provider.ts`（245 行）→ | `groq.provider.ts`（382 行） |
| Features list (lines 210-214) | No RPM tracking mentioned | Add "每 Key RPM 追踪（30次/分钟滚动窗口）" and "智能 Key 选择（按最低 RPM 选取最优 Key）" |
| `generateText()` pseudocode (lines 224-229) | Simple: check key → POST to API → handle 429 (block single key, rotate) | Replace with: RPM-aware `selectBestKey()` → record timestamp → POST → on 429: read Retry-After header, block ALL keys, return null immediately |

**New pseudocode for `generateText()`:**
```typescript
async generateText(prompt: string, options?: AiGenerationOptions): Promise<string | null> {
  // 1. Proactive RPM check: select the least-loaded key
  //    If all keys are blocked or at RPM limit, return null immediately
  //    (no waiting inside generateText() — prevents retry storm)
  const selected = this.selectBestKey();
  if (!selected) return null;

  // 2. Record request timestamp (rolling 60s window for RPM tracking)
  this.pruneStaleTimestamps(currentKey);
  currentKey.requestTimestamps.push(Date.now());

  // 3. POST to Groq API
  // 4. Handle 429 → read Retry-After header, block ALL keys, return null immediately
  // 5. Success → update daily counters, return content
  // 6. Failure → remove the recorded timestamp, return null
}
```

### Change 1.4 — Failure scenario table: Update Groq 429 handling (Section 5, lines 346-351)

**Line 349 current:**
`| Groq 429 限流 | Groq | 封禁该 Key 60 秒，轮换到下一个 Key | 短暂延迟后恢复 |`

**Updated:**
`| Groq 429 限流 | Groq | 读取 Retry-After header 封锁所有 Key，立即返回 null | Groq 不可用直至冷却到期（依赖 Retry-After header） |`

Add a new row after line 350:
`| Groq 账户级限流（所有 Key 共享） | Groq | 所有 Key 同时被封禁，返回 null | 需切换至 Gemini/DeepSeek 或等待冷却到期 |`

### Change 1.5 — Rate limiter section: Update KEY_429_COOLDOWN note (Section 6.2, lines 373-388)

**Line 382 current:**
`KEY_429_COOLDOWN: 60000,    // 429 冷却 60 秒`

**Action:** Add a clarification that this constant is now overridden by `GroqProvider`'s own `KEY_429_COOLDOWN_DEFAULT = 120000`, and Groq additionally reads the `Retry-After` header from the API response which can specify much longer cooldowns (up to 8400 seconds).

---

## Article 2: `docs/blog/architecture/AI_PROVIDER_ABSTRACTION_ARCHITECTURE.md`

### Change 2.1 — AiKeyInstance: Add `requestTimestamps` note (Section, lines 102-113)

Same as Change 1.1 — add paragraph explaining internal `requestTimestamps` field for RPM tracking.

### Change 2.2 — AiProviderUsageStats: Add `currentRpm` and `rpmLimit` (Section, lines 115-133)

Same as Change 1.2 — add the two optional fields to the stats keys interface snippet.

### Change 2.3 — GroqProvider section: Full replacement of code snippet (Section, lines 211-271)

This is the most impactful change. The entire `generateText()` code block (lines 226-269) must be replaced.

**Current code (lines 226-269):**
- Simple `this.keyInstances[this.activeKeyIndex]` access
- `if (key.blocked) { if (!this.rotateToNextKey()) return null; }`
- `catch (error: any) { if (429) { key.blocked=true; ... rotateToNextKey(); } }`

**Action:** Replace with the current implementation that includes:
1. `selectBestKey()` at start (RPM-aware)
2. Timestamp recording (`pruneStaleTimestamps` + `push`)
3. Expanded error handling (429 block ALL keys with Retry-After, 400 error, timeout, generic)
4. Timestamp removal on failure (`currentKey.requestTimestamps.pop()`)

Also update:
- Line 213: `245 行` → `382 行`
- Lines 215-223: Add RPM tracking to the attribute table

### Change 2.4 — Code mapping table: Update line counts (Section, lines 720-731)

| File | Current | Updated |
|------|---------|---------|
| `groq.provider.ts` | 245 | 382 |
| `ai-provider.interface.ts` | 47 | 50 |

### Change 2.5 — Add New Provider guide template (Section, lines 514-667)

**Optional:** Update the template `generateText()` to show best practices (RPM-aware selection, Retry-After handling), but keep it simple enough for generic new providers. This is lower priority.

---

## Article 3: `docs/blog/groq-api-key-guide.md`

### Change 3.1 — Rate limit section: Add account-level note (lines 33-41)

**Add after the rate limit table:**
> **重要：所有 Groq API Key 共享同一个账户级别的速率限制。** 配置多个 Key 不会叠加总容量（例如 4 个 Key 仍然是 30 RPM 而非 120 RPM）。多 Key 的设计目的是当某个 Key 因 429 被封禁时，系统可以自动选择其他 Key——但由于是账户级限制，所有 Key 可能同时被封禁。

### Change 3.2 — Troubleshooting: "Rate limit exceeded" (lines 72-75)

**Current:**
> - Groq free tier allows 30 requests per minute
> - The system automatically handles rate limiting with cooldown and key rotation
> - If you have multiple keys, they will be rotated automatically

**Updated:**
> - Groq free tier allows ~30 requests per minute per account (all keys share this limit)
> - The system tracks per-key RPM using a rolling 60-second window and proactively selects the least-loaded key
> - When rate limiting occurs (HTTP 429), the system reads the `Retry-After` header and blocks ALL keys for that duration
> - Multiple keys do NOT multiply your rate limit — they share the same account-level quota
> - If all keys are blocked, try switching the AI provider to Gemini or DeepSeek via Admin UI

### Change 3.3 — Add Retry-After header explanation (new section, after line 75)

**Add a new "Rate Limit Recovery" section:**
> ### Retry-After header handling
> When Groq returns a 429 response, it may include a `Retry-After` header specifying the number of seconds to wait before retrying. The system respects this header precisely — all keys are blocked for the duration indicated. This can be as short as 60 seconds or as long as 8400 seconds (~2.3 hours) depending on the violation severity. The `unblockExpiredKeys()` method runs every second and automatically unblocks keys when the cooldown expires.

---

## Files Modified (Summary)

| File | Changes |
|------|---------|
| `docs/blog/articles/api/ai-service-multi-provider-abstraction-layer.md` | 5 sections: AiKeyInstance, AiProviderUsageStats, GroqProvider code, failure scenarios table, rate limiter constants |
| `docs/blog/architecture/AI_PROVIDER_ABSTRACTION_ARCHITECTURE.md` | 5 sections: AiKeyInstance, AiProviderUsageStats, GroqProvider full code replacement, code mapping table, provider template |
| `docs/blog/groq-api-key-guide.md` | 3 sections: rate limit table note, troubleshooting rewrite, new Retry-After section |

## Implementation Order

1. Update `docs/blog/articles/api/ai-service-multi-provider-abstraction-layer.md` — user-facing article (most visible)
2. Update `docs/blog/architecture/AI_PROVIDER_ABSTRACTION_ARCHITECTURE.md` — technical reference
3. Update `docs/blog/groq-api-key-guide.md` — operational guide

Each file requires surgical `apply_diff` edits (SEARCH/REPLACE blocks) to update specific sections without rewriting the entire file.
