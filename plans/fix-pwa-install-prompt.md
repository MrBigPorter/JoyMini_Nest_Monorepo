# PWA Install Prompt Fix Plan

## Overview
Fix two issues with the PWA install prompt:
1. **X close button not working** — decorative circle elements overlap the button and intercept clicks
2. **Blog name incorrect** — references "JoyMinis博客" instead of "Tarsier Labs"

## Files to Modify

### 1. [`apps/frontend-blog/src/components/pwa/InstallPrompt.tsx`](../apps/frontend-blog/src/components/pwa/InstallPrompt.tsx)
- **Root cause**: Lines 163-164 have two `absolute`-positioned decorative circle `<div>` elements rendered AFTER the X button in DOM order. They lack `pointer-events-none`, so they intercept click events meant for the X button below them.
- **Fix**: Add `pointer-events-none` class to both decorative circle divs so clicks pass through to the X button.

### 2. i18n message files (6 files)
"Tarsier Labs" is a brand name — it stays **untranslated** across all locales. Only the brand name string within each locale's message needs replacement.

| File | Current Message | New Message |
|------|----------------|-------------|
| [`apps/frontend-blog/src/messages/zh.json`](../apps/frontend-blog/src/messages/zh.json:288) | `将JoyMinis博客添加到主屏幕，获得更好的阅读体验！` | `将Tarsier Labs添加到主屏幕，获得更好的阅读体验！` |
| [`apps/frontend-blog/src/messages/en.json`](../apps/frontend-blog/src/messages/en.json:288) | `Add JoyMinis Blog to your home screen for a better reading experience!` | `Add Tarsier Labs to your home screen for a better reading experience!` |
| [`apps/frontend-blog/src/messages/ja.json`](../apps/frontend-blog/src/messages/ja.json:288) | `より良い読書体験のためにJoyMinisブログをホーム画面に追加しましょう！` | `より良い読書体験のためにTarsier Labsをホーム画面に追加しましょう！` |
| [`apps/frontend-blog/src/messages/ko.json`](../apps/frontend-blog/src/messages/ko.json:288) | `더 나은 독서 경험을 위해 JoyMinis 블로그를 홈 화면에 추가하세요!` | `더 나은 독서 경험을 위해 Tarsier Labs를 홈 화면에 추가하세요!` |
| [`apps/frontend-blog/src/messages/fr.json`](../apps/frontend-blog/src/messages/fr.json:288) | `Ajoutez JoyMinis Blog à votre écran d'accueil pour une meilleure expérience de lecture !` | `Ajoutez Tarsier Labs à votre écran d'accueil pour une meilleure expérience de lecture !` |
| [`apps/frontend-blog/src/messages/de.json`](../apps/frontend-blog/src/messages/de.json:288) | `Fügen Sie JoyMinis Blog zu Ihrem Startbildschirm hinzu für ein besseres Leseerlebnis!` | `Fügen Sie Tarsier Labs zu Ihrem Startbildschirm hinzu für ein besseres Leseerlebnis!` |

### 3. Manifest files (2 files)
Update the PWA app name and short name to reflect the new brand.

| File | Current | New |
|------|---------|-----|
| [`apps/frontend-blog/public/manifest.json`](../apps/frontend-blog/public/manifest.json:2) | `name: "JoyMinis Blog"`, `short_name: "JoyMinis"` | `name: "Tarsier Labs"`, `short_name: "Tarsier"` |
| [`apps/frontend-blog/public/manifest-zh.json`](../apps/frontend-blog/public/manifest-zh.json:2) | `name: "JoyMinis 技术博客"`, `short_name: "JoyMinis"` | `name: "Tarsier Labs"`, `short_name: "Tarsier"` |

## Execution Order

1. Add `pointer-events-none` to both decorative circles in `InstallPrompt.tsx` (lines 163-164)
2. Update `pwa.install.message` in all 6 locale JSON files
3. Update `name` and `short_name` in both manifest JSON files
4. Run `yarn workspace @lucky/frontend-blog type-check` to verify no TypeScript errors
5. Inform user to restart dev server and test

## Verification
- X close button click should close the install prompt
- Install prompt message should display "Tarsier Labs" (untranslated) in all locales
- PWA manifest should show "Tarsier Labs" as the app name
