# Plan: Fix Incomplete Translations (All Languages)

## Background

The admin-blog translation quality detection page at [`/blog/translation-quality`](apps/admin-blog/src/views/blog/BlogTranslationQualityDetection.tsx) reports 16 articles with incomplete/broken translations (the detection page shows EN by default, but the bug affects **all languages** — ja, ko, fr, de, etc.). The user has already tried **"Clear & Re-translate"** on these articles, but the detection **still reports the same issues** after re-running detection.

## Critical Root Cause Finding (from code analysis)

I read the translation processor code [`blog-ai.processor.ts:1295-1335`](apps/api/src/blog/processors/blog-ai.processor.ts:1295):

```
// 不要重新抛出错误，避免队列无限重试
return {
  success: false,
  error: err instanceof Error ? err.message : 'Unknown error',
  articleId: data.articleId,
};
```

**The catch block swallows all errors and returns instead of re-throwing them.** This means:

1. BullMQ marks the job as **completed successfully** (no error propagated to the queue)
2. The article's `translationStatus` is set to `'FAILED'` in the DB
3. The translation job record is set to `'FAILED'`
4. **No visible error appears in the BullMQ queue UI** — it shows "completed"

**So the "Clear & Re-translate" flow:**
1. Clear ✅ — Deletes EN fields from DB
2. Queue job ✅ — Job added to BullMQ
3. Job runs ❌ — AI call fails (timeout/token limit/rate limit)
4. Catch block ✅ — Silently returns, BullMQ sees "completed"
5. Detection runs ❌ — Finds empty EN fields, reports same 16 articles again

### Why translation actually fails

The AI token limit is **NOT** the issue — the processor already sets [`maxOutputTokens: 8192`](apps/api/src/blog/processors/blog-ai.processor.ts:487) for translation. The real failure causes are likely:

| Cause | Evidence | Likelihood |
|-------|----------|------------|
| **AI API timeout** — Long articles (>10k chars) exceed the model's context window or the provider's timeout | Some articles have 90+ headings and 100+ tables | Very High |
| **Rate limiting (429)** — The 600ms delay between jobs may not be enough for the provider | `handleRateLimit` exists at line 76 | Medium |
| **Daily budget exceeded** — `getServiceLevel() === DISABLED` check at line 997 | Budget check runs first, just returns silently | Medium |
| **OpenSSL error** — `ERR_OSSL_UNSUPPORTED` on newer Node.js versions | Detected at line 1310 | Low |

---

## Execution Plan

### Phase 1: Diagnose the VPS & BullMQ Queue

**Since the VPS is down (RackNerd ticket submitted), we need to diagnose remotely.**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1a | Wait for VPS to come back online | SSH accessible, Docker running |
| 1b | Check Docker containers: `docker ps -a` | See api container status |
| 1c | Check api container logs: `docker logs <api-container> --tail 200` | See failed translation errors |
| 1d | Check BullMQ failed jobs via admin UI | `/blog/translation-progress` → see completed jobs with `success: false` |
| 1e | Check translation jobs table via API | `GET /blog/translation/jobs-detail?targetLang=en&pageSize=50` |
| 1f | Check AI provider health | `GET /blog/ai-status` → verify provider is healthy |
| 1g | Check Node.js version for OpenSSL errors | `node --version` |

### Phase 2: Fix the Silently-Failing Job Problem

**This is the most important fix.** The catch block at [`blog-ai.processor.ts:1295`](apps/api/src/blog/processors/blog-ai.processor.ts:1295) must be changed so that failed jobs are visible.

**Changes to [`blog-ai.processor.ts`](apps/api/src/blog/processors/blog-ai.processor.ts):**

```typescript
// Line 1295 - Change from:
catch (err) {
  this.logger.error(`Article translation failed for ${data.articleId}`, err);
  // ... update DB to FAILED ...
  return { success: false, error: ... };  // ❌ BullMQ marks as completed
}

// To:
catch (err) {
  this.logger.error(`Article translation failed for ${data.articleId}`, err);
  // ... update DB to FAILED ...
  throw err;  // ✅ BullMQ marks as failed, visible in queue UI
}
```

**Same fix needed for:**
- [`processCategoryTranslation`](apps/api/src/blog/processors/blog-ai.processor.ts:1338) — Check line ~1430+
- [`processTagTranslation`](apps/api/src/blog/processors/blog-ai.processor.ts:1527) — Check line ~1620+

**Risk:** The original comment says "avoid infinite retry". We need to check BullMQ's `retry` config on the queue/worker decorator to ensure a finite retry limit is set.

✅ Check: [`@Processor('blog-ai', { concurrency: 1 })`](apps/api/src/blog/processors/blog-ai.processor.ts:17) — No `max` or `retry` configured. We should add:
```typescript
@Processor('blog-ai', {
  concurrency: 1,
  // Add job options to limit retries
})
// Plus in the defaultJobOptions when adding jobs:
await this.blogAiQueue.add('translate-article', data, {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
});
```

### Phase 3: Clear & Re-translate All 16 Articles

After the fix in Phase 2:

| Step | Action |
|------|--------|
| 3a | Clear failed jobs from BullMQ queue (if any remain) |
| 3b | Clear EN translations for all 16 articles via API |
| 3c | Queue re-translation jobs for all 16 articles |
| 3d | Monitor queue UI to verify jobs complete successfully (not silently fail) |
| 3e | Run detection again → verify all 16 pass |

### Phase 4: Fix Edge Cases

| # | Article | Issue | Fix |
|---|---------|-------|-----|
| 1 | `http-client-auth-refresh-retry` | EN == ZH (not translated at all) | Re-translate should fix |
| 2 | `smart-table-generic-data-grid` | EN == ZH (not translated at all) | Re-translate should fix |
| 3 | `各层职责` | No source file, ratio 7.5 | DB orphan → delete from admin |
| 4 | `register-application-workflow` | Ratio 4.13 (translated EN is much longer than ZH) | Acceptable technical article trait, or adjust threshold |

### Phase 5: Improve Detection Algorithm Thresholds (Optional)

**Changes to [`detectTranslationQuality()`](apps/api/src/blog/blog.service.ts:3046):**

| Check | Current | Proposed | Rationale |
|-------|---------|----------|-----------|
| Code block count | Strict equality (`!==`) | Tolerance ±2 | Code blocks can be merged/split during translation |
| Table row count | Difference > 2 | Difference > 5 | Tables are the most commonly truncated element |
| List item count | Difference > 20% | Difference > 30% | List formatting varies between ZH and EN |
| Length ratio (long) | [0.8, 2.5] | [0.6, 3.0] | Tech articles with code have very different ZH/EN ratios |
| Length ratio (short) | [0.8, 4.0] | [0.6, 5.0] | Very short articles can have extreme ratios |

---

## File Changes Summary

| Phase | File | Change | Risk |
|-------|------|--------|------|
| 2 | [`blog-ai.processor.ts:1295`](apps/api/src/blog/processors/blog-ai.processor.ts) | Re-throw errors instead of swallowing them in `processArticleTranslation` catch | Low-Medium — need to set retry limits |
| 2 | [`blog-ai.processor.ts:~1460`](apps/api/src/blog/processors/blog-ai.processor.ts) | Same fix for `processCategoryTranslation` catch | Low |
| 2 | [`blog-ai.processor.ts:~1650`](apps/api/src/blog/processors/blog-ai.processor.ts) | Same fix for `processTagTranslation` catch | Low |
| 2 | [`blog.module.ts`](apps/api/src/blog/blog.module.ts) | Add `defaultJobOptions` with `attempts: 3, backoff` to BullMQ registerQueue | Low |
| 2 | [`blog.service.ts`](apps/api/src/blog/blog.service.ts) | Add retry config to all `blogAiQueue.add()` calls for translation jobs | Low |
| 5 | [`blog.service.ts:3046`](apps/api/src/blog/blog.service.ts) | Adjust detection thresholds (tolerances) | Low |

---

## Execution Order

```
1. Phase 1  — 🩺 Diagnose (wait for VPS, check logs, check queue)
2. Phase 2  — 🧹 Fix the silently-failing job bug (re-throw errors + retry config)
3. Phase 3  — 🔄 Re-translate all 16 articles (clear + queue + monitor)
4. Phase 4  — 🗑️ Edge cases (delete orphan article)
5. Phase 5  — 🔧 Detection thresholds (optional, reduce false positives)
```

## Key Insight

The root cause is **not** about AI token limits or `maxOutputTokens`. The processor already uses 8192 tokens. The real bug is in the **error handling pattern**: errors are caught and swallowed to prevent infinite retries, but this makes failures invisible. The fix is to **re-throw errors with proper finite retry limits** so BullMQ can properly manage retries and show failed jobs in the UI.
