# Fix: fr/de Language Tabs Showing Chinese in Front Blog

## Root Cause Analysis

In `apps/frontend-blog/src/app/[locale]/layout.tsx`, the `allMessages` object that maps locale codes to imported message JSON files **does not include `fr` and `de`**.

### Current code (lines 4-7, 167-173):

```typescript
// Only 4 locales imported!
import zhMessages from '@/messages/zh.json';
import enMessages from '@/messages/en.json';
import jaMessages from '@/messages/ja.json';
import koMessages from '@/messages/ko.json';

// fr and de are MISSING from this map
const allMessages: Record<string, any> = {
  zh: zhMessages,
  en: enMessages,
  ja: jaMessages,
  ko: koMessages,
};
const messages = allMessages[locale] || allMessages['zh'];
```

When `locale = 'fr'`:
- `allMessages['fr']` → `undefined`
- Falls back to `allMessages['zh']` → **Chinese messages are used for everything**
- `t('common.all')` → "全部" instead of "Tout"
- Every `t(...)` translation returns Chinese

## Fix Plan

**File to modify:** `apps/frontend-blog/src/app/[locale]/layout.tsx`

### Step 1: Add imports (line 8)
```typescript
import frMessages from '@/messages/fr.json';
import deMessages from '@/messages/de.json';
```

### Step 2: Add to allMessages map (lines 172-173)
```typescript
const allMessages: Record<string, any> = {
  zh: zhMessages,
  en: enMessages,
  ja: jaMessages,
  ko: koMessages,
  fr: frMessages,   // NEW
  de: deMessages,   // NEW
};
```

### Step 3: Verify
- Run `yarn workspace @lucky/frontend-blog check-types` to type-check
- Run `yarn workspace @lucky/frontend-blog dev` and test `/fr/` and `/de/` routes

## Category Names (Secondary)

Category names rendered by `CategoryFilter.tsx` come from the backend API via `getLocalizedString()`. If categories have `fr`/`de` translations stored in the database (via `nameLocalized` JSON field), they will automatically resolve correctly once:
1. This message import fix is applied (for `t(...)` translations)
2. The category names themselves are translated via the batch AI translation processor

## Risk Assessment
- Minimal risk: adding 2 imports and 2 keys to an object
- No breaking changes to existing locales
- If imports fail, build will fail immediately (compile-time safety)
- Rollback: simply remove the 2 lines
