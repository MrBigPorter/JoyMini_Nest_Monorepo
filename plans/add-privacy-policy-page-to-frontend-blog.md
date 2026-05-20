# Plan: Add Privacy Policy Page to Frontend Blog

> **Status**: ✅ Plan finalized — ready for implementation
> **Decisions confirmed**: Footer-only nav, comprehensive content scope, no global footer extraction, TS constants file approach, change "React Native MMKV" to generic description

## Overview

Add a Privacy Policy page at `https://blog.joyminis.com/[locale]/privacy` that serves dual purposes:
1. **Store submission** (Google Play / App Store Connect) — URL `https://blog.joyminis.com/privacy`
2. **App内 "View Web Version"** — mobile app's PrivacyPolicyScreen links here

## Approach Change

**Instead of JSON i18n keys** (original plan), use a **TypeScript constants file** with full markdown content per locale. This is better because:
- Long markdown text in JSON requires excessive escaping
- TS template strings keep content readable
- Privacy policy is static content, not dynamic UI translation

## Files to Create

### 1. Privacy Content Constants

**`apps/frontend-blog/src/lib/privacy/privacy-content.ts`**

- Export `PRIVACY_CONTENT: Record<string, string>` with full markdown for all 6 locales
- Export `getPrivacyPolicyContent(locale: string): string` helper with English fallback
- Content covers 11 sections: data collection, usage, sharing, retention, rights, third-party services, children's privacy, international transfers, security, changes, contact
- Change "React Native MMKV" reference to generic description like "local device storage"

### 2. Privacy Page Component

**`apps/frontend-blog/src/app/[locale]/privacy/page.tsx`**

- Server component (async, uses `getPrivacyPolicyContent()`)
- Follow same pattern as [`about/page.tsx`](apps/frontend-blog/src/app/[locale]/about/page.tsx)
- Key behaviors:
  - `generateStaticParams` — pre-render for all 6 locales
  - `revalidate = 3600` — ISR every hour
  - SEO metadata: `title`, `description`, `robots: { index: true, follow: true }`, canonical URL
  - Render markdown content (use existing [`ArticleMarkdown.tsx`](apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx) or simple prose styling)

## Files to Modify

### 3. Sitemap — Add Privacy Page Entry

**`apps/frontend-blog/src/app/[locale]/sitemap.ts`** (around line 40, after `/about/` entry)

```typescript
sitemapEntries.push({
  url: `${baseUrl}/${locale}/privacy/`,
  lastModified: new Date(),
  changeFrequency: 'monthly' as const,
  priority: 0.5,
});
```

### 4. About Page Footer — Add Privacy Link

**`apps/frontend-blog/src/app/[locale]/about/page.tsx`** (around line 421)

Replace the single copyright line with:
```tsx
<div className="flex items-center justify-center gap-4 text-sm text-muted-foreground">
  <Link href="/privacy" className="hover:text-foreground transition-colors">
    Privacy Policy
  </Link>
  <span>·</span>
  <span>{t('about.copyright')}</span>
</div>
```

**Note**: `href="/privacy"` uses next-intl's i18n-aware Link, auto-prefixes current locale.

## What We Are NOT Modifying

- **Sidebar** ([`Sidebar.tsx`](apps/frontend-blog/src/components/navigation/Sidebar.tsx)) — no privacy link added
- **BottomNavigation** ([`BottomNavigation.tsx`](apps/frontend-blog/src/components/BottomNavigation.tsx)) — no privacy link added
- **Layout** ([`layout.tsx`](apps/frontend-blog/src/app/[locale]/layout.tsx)) — no global footer extracted
- **No JSON message files** — content lives in TS constants instead

## Route Behavior

| URL | Behavior |
|-----|----------|
| `https://blog.joyminis.com/en/privacy` | English version (SSG) |
| `https://blog.joyminis.com/zh/privacy` | Chinese version (SSG, default) |
| `https://blog.joyminis.com/privacy` | Redirects to `/zh/privacy` via middleware |
| `https://blog.joyminis.com/ja/privacy` | Japanese version (SSG) |
| `https://blog.joyminis.com/ko/privacy` | Korean version (SSG) |
| `https://blog.joyminis.com/fr/privacy` | French version (SSG) |
| `https://blog.joyminis.com/de/privacy` | German version (SSG) |

## Implementation Order

1. Create [`privacy-content.ts`](apps/frontend-blog/src/lib/privacy/privacy-content.ts) with all 6 locales
2. Create privacy page component at [`apps/frontend-blog/src/app/[locale]/privacy/page.tsx`](apps/frontend-blog/src/app/[locale]/privacy/)
3. Update sitemap at [`apps/frontend-blog/src/app/[locale]/sitemap.ts`](apps/frontend-blog/src/app/[locale]/sitemap.ts)
4. Add footer link to [`apps/frontend-blog/src/app/[locale]/about/page.tsx`](apps/frontend-blog/src/app/[locale]/about/page.tsx)
5. Type-check and lint the implementation
