# Admin Blog: Browser Language Detection for i18n

## Objective

Enable the admin blog to automatically detect the user's browser language on first visit and switch to the matching locale. If no match is found, fall back to **English** (not Chinese).

## Current Architecture Comparison

### Frontend Blog (reference implementation)

| Feature | Implementation |
|---|---|
| URL-based locale routing | `[locale]` in path, e.g. `/en/articles/...` |
| Middleware detection | `Accept-Language` header → `NEXT_LOCALE` cookie → redirect |
| Client-side detection | `I18nProvider` reads `navigator.language` on first visit |
| Fallback language | `en` (English) |
| Priority | URL path > Cookie > Accept-Language > Default (`en`) |

### Admin Blog (current)

| Feature | Implementation |
|---|---|
| URL-based locale routing | ❌ No `[locale]` in path, purely cookie-based |
| Middleware detection | ❌ Only handles auth, no locale detection |
| Client-side detection | ❌ None |
| Fallback language | `zh` (Chinese) from `@lucky/shared` `DEFAULT_LOCALE` |
| Locale persistence | `NEXT_LOCALE` cookie set via `LanguageProvider.setLocale()` |

## Proposed Changes

Since the admin blog does **not** use URL-based locale routing (no `[locale]` param), the approach is simpler than the frontend blog — no URL redirects needed, just cookie-based detection.

### Files to Create/Modify

#### 1. New file: [`apps/admin-blog/src/lib/utils/locale.ts`](../../apps/admin-blog/src/lib/utils/locale.ts)

Create a utility module modeled after [`apps/frontend-blog/src/lib/utils/locale.ts`](../../apps/frontend-blog/src/lib/utils/locale.ts), adapted for the admin blog's cookie-based approach.

**Functions:**
- `parseAcceptLanguage(header: string | null): Locale | null` — Parse `Accept-Language` header, return best matching supported locale
- `detectLocaleFromBrowser(): Locale` — Read `navigator.language` client-side (only callable in browser)
- `detectLocaleFromRequest(request: NextRequest): Locale` — For middleware use, reads `Accept-Language` header
- `isSupportedLocale(code: string): boolean` — Check if locale is in supported list
- `FALLBACK_LOCALE = 'en'` — Fallback to English when no match

**Key behavior:**
- Priority: `NEXT_LOCALE` cookie (user already chose) > `Accept-Language` header (browser detection) > `en` (fallback)
- Only auto-detect when no `NEXT_LOCALE` cookie exists (first visit)

#### 2. Modify: [`apps/admin-blog/src/middleware.ts`](../../apps/admin-blog/src/middleware.ts)

Add locale detection logic **before** the auth check. When no `NEXT_LOCALE` cookie exists:
1. Read `Accept-Language` from request headers
2. Parse to find best matching supported locale
3. If match found and differs from current default, set `NEXT_LOCALE` cookie in the response
4. Fall back to `en` if no match

**Important considerations:**
- Must not interfere with existing auth logic
- Cookie should have appropriate `max-age` and `SameSite` settings
- Should not cause redirect loops

#### 3. New file: [`apps/admin-blog/src/lib/providers/I18nProvider.tsx`](../../apps/admin-blog/src/lib/providers/I18nProvider.tsx)

Client-side `I18nProvider` component (similar to [`apps/frontend-blog/src/lib/providers/I18nProvider.tsx`](../../apps/frontend-blog/src/lib/providers/I18nProvider.tsx)) that:

1. On mount, checks if `NEXT_LOCALE` cookie exists
2. If no cookie exists (first visit):
   - Reads `navigator.language` → extracts primary language tag
   - Checks if it's a supported locale
   - If supported and different from current locale, sets `NEXT_LOCALE` cookie
   - Calls `router.refresh()` to re-render with new locale
3. If no match from browser, does **nothing** (server will use English fallback)
4. If cookie exists (returning user), does nothing (respects user's choice)

**Edge cases:**
- `navigator.language` might return `en-US`, we extract `en`
- Unsupported languages like `th` (Thai), `vi` (Vietnamese) should fall through to English
- Language codes are case-insensitive (`EN` → `en`)

#### 4. Modify: [`apps/admin-blog/src/app/layout.tsx`](../../apps/admin-blog/src/app/layout.tsx)

Wrap children with the new `I18nProvider` client component:

```tsx
import I18nProvider from '@/lib/providers/I18nProvider';
// ...
<NextIntlClientProvider locale={locale} messages={messages}>
  <I18nProvider>
    <Providers>{children}</Providers>
  </I18nProvider>
</NextIntlClientProvider>
```

#### 5. Modify: [`apps/admin-blog/src/i18n/request.ts`](../../apps/admin-blog/src/i18n/request.ts)

Update the locale resolution logic to also consider `Accept-Language` header as a fallback when no `NEXT_LOCALE` cookie exists.

**Current priority (request.ts):**
1. `NEXT_LOCALE` cookie
2. `requestLocale` (always undefined since no next-intl middleware)
3. `DEFAULT_LOCALE` (`zh`)

**New priority:**
1. `NEXT_LOCALE` cookie
2. `Accept-Language` header (parse via utility)
3. `DEFAULT_LOCALE` → changed to `en` for the detection fallback

**Note:** We should keep the system's `DEFAULT_LOCALE` in `@lucky/shared` as `zh`, but in the request config, the fallback when no cookie and no browser match should be `en`.

### Dependency Graph

```
New: src/lib/utils/locale.ts       (shared utility, no deps)
         │
         ├── src/middleware.ts      (SSR detection from Accept-Language)
         │
         ├── src/i18n/request.ts   (SSR fallback detection)
         │
         └── src/lib/providers/I18nProvider.tsx  (CSR detection from navigator.language)
                  │
                  └── src/app/layout.tsx  (wrap with I18nProvider)
```

### Data Flow

```
First Visit (no cookie):
  Browser ──GET /──> Middleware ──reads Accept-Language──> sets NEXT_LOCALE cookie
                                                                    │
  Browser <──HTML── Layout ──getLocale() reads NEXT_LOCALE cookie──┘
                                                                   
  Client Hydration:
    I18nProvider ──reads navigator.language──> if no cookie yet, sets NEXT_LOCALE
                                              ──> router.refresh() to re-render

Returning Visit (has cookie):
  Browser ──GET /──> Middleware ──finds NEXT_LOCALE cookie──> skip detection
  Browser <──HTML── Layout ──reads NEXT_LOCALE cookie──> render in chosen locale
```

## Execution Steps

| # | Step | Files | Description |
|---|------|-------|-------------|
| 1 | Create locale utility | `src/lib/utils/locale.ts` | `parseAcceptLanguage()`, `detectLocaleFromRequest()`, `detectLocaleFromBrowser()`, `isSupportedLocale()` |
| 2 | Update request config | `src/i18n/request.ts` | Add `Accept-Language` parsing as fallback, change detection fallback to `en` |
| 3 | Update middleware | `src/middleware.ts` | Add `Accept-Language` detection for first visits, set `NEXT_LOCALE` cookie |
| 4 | Create I18nProvider | `src/lib/providers/I18nProvider.tsx` | Client-side `navigator.language` detection, cookie setting, refresh |
| 5 | Update layout | `src/app/layout.tsx` | Wrap children with `I18nProvider` |

## Configuration Details

### Supported Locales (from `@lucky/shared`)

```typescript
['zh', 'en', 'ja', 'ko', 'fr', 'de']
```

### Fallback Behavior

| Scenario | Result |
|---|---|
| Browser: `zh-CN,zh;q=0.9` | `zh` |
| Browser: `en-US,en;q=0.9` | `en` |
| Browser: `ja;q=0.9` | `ja` |
| Browser: `th;q=0.9` (unsupported) | `en` (fallback) |
| Browser: `ko-KR,ko;q=0.9,en;q=0.5` | `ko` |
| No `Accept-Language` header | `en` (fallback) |
| Returning user with `NEXT_LOCALE=zh` cookie | `zh` (preserve choice) |
| User manually switched to `fr` | `fr` (cookie takes priority) |

### Cookie Settings

- **Name:** `NEXT_LOCALE`
- **Path:** `/`
- **Max-Age:** 1 year (31536000 seconds)
- **SameSite:** `Lax`
- **Secure:** `true` (in production)

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Infinite refresh loop from cookie detection | Only set cookie once; check existence before setting |
| Flash of wrong locale before client-side detection | Middleware handles SSR; client-side is progressive enhancement |
| Breaking existing language switch behavior | `LanguageSwitch` uses same `setLocale()` → same cookie → refresh flow unaffected |
| Conflicting with `useAppStore` persisted `lang` | `LanguageProvider.setLocale()` already syncs to `useAppStore` |
