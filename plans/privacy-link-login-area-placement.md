# Privacy Policy Link - Login Area Placement Plan

## Goal
Move the Privacy Policy link from Sidebar/BottomNavigation to the **Header login area** (desktop) and **Mobile settings drawer** (mobile), making it look elegant and native to the UI.

## Design

### Desktop Header — Right side action area
```
[Search...]  [🌙]  [🇺🇸 EN]  │  Privacy  │  [Login / User]
```

The "Privacy" link will be:
- `text-xs` size, `text-muted-foreground` color
- `hover:text-foreground hover:underline` interaction
- Separated by subtle vertical bars (`|`) with `text-muted-foreground/30`
- Uses `Link` from `@/navigation` for i18n locale prefix

This follows a common pattern (Stripe, GitHub, Vercel) where legal links live near the auth area.

### Mobile Settings Drawer — Bottom section
In `MobileSettingsContent.tsx`, add at the bottom of the settings list (after logout):

```
┌──────────────────────────┐
│   🌙  Theme              │
│   🌐  Language           │
│   ...                    │
│   📕  Bookmarks          │  (if logged in)
│   🚪  Logout             │  (if logged in)
├──────────────────────────┤
│   🔒  Privacy Policy     │  ← Always visible at bottom
└──────────────────────────┘
```

With Shield icon + `common.privacy` label, consistent with other rows' styling.

## Changes Required

| # | File | Action | Description |
|---|------|--------|-------------|
| 1 | `apps/frontend-blog/src/components/navigation/Sidebar.tsx` | Revert | Remove `Shield` import and privacy nav item |
| 2 | `apps/frontend-blog/src/components/BottomNavigation.tsx` | Revert | Remove privacy nav item from array |
| 3 | `apps/frontend-blog/src/components/Header.tsx` | Modify | Add privacy link with separators near login button (desktop only) |
| 4 | `apps/frontend-blog/src/components/mobile/MobileSettingsContent.tsx` | Modify | Add privacy link at bottom of settings |

## Files to Keep As-Is
- `apps/frontend-blog/src/app/[locale]/privacy/page.tsx` ✅
- `apps/frontend-blog/src/app/[locale]/privacy/PrivacyMarkdown.tsx` ✅
- `apps/frontend-blog/src/lib/privacy/privacy-content.ts` ✅
- `apps/frontend-blog/src/app/[locale]/sitemap.ts` ✅
- `apps/frontend-blog/src/app/[locale]/about/page.tsx` (footer link) ✅
- All 6 locale message files (`common.privacy`) ✅
