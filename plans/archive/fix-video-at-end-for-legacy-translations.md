# Fix: Video at End for Legacy Translation Data

## Root Cause

The condition at [`frontend-blog.service.ts:367`](../apps/api/src/blog/frontend/frontend-blog.service.ts:367) only checks `result.content` (HTML field) for video tags:

```typescript
if (result.content && /<video[\s\S]*?<\/video>/i.test(result.content)) {
```

For **legacy translation data** (translated before the placeholder fix was deployed):
- `contentLocalized['en']` (HTML) has **NO video tags** — old code stripped videos before rendering Markdown→HTML
- `contentMdLocalized['en']` (Markdown) has video at the **END** — old `injectVideosIntoMarkdown` appended them

Since `result.content` has no video, the entire block is skipped. `injectVideosIntoMarkdown` never runs. The video stays at the end.

## Fix

Change the condition to check **both** `result.content` (HTML) and `result.contentMd` (Markdown) for video tags. Only skip `injectVideosIntoMarkdown` when **both** fields have videos (indicating placeholder-fixed data where video is at the correct position).

## File Changed

[`apps/api/src/blog/frontend/frontend-blog.service.ts`](../apps/api/src/blog/frontend/frontend-blog.service.ts:367) — `mapArticleForFrontend` method, lines 362-390.

## Condition Matrix After Fix

| Scenario | contentHasVideo | mdHasVideo | Behavior |
|----------|----------------|------------|----------|
| New translation (placeholder fix) | ✅ correct pos | ✅ correct pos | Skip injection → video stays correct ✅ |
| Old translation (legacy) | ❌ no video | ✅ at end | injectVideosIntoMarkdown runs → video moved to heading ✅ |
| First-time view (Quill article) | ✅ in HTML | ❌ no video | injectVideosIntoMarkdown runs ✅ |
