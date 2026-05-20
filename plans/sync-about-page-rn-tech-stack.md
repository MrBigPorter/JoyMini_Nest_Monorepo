# Sync About Page — Add React Native Tech Stack to Mobile Category

## Objective
Add React Native tech stack items (from the RN AboutScreen.tsx) to the Mobile category in the web About page.

## Current State
The Mobile category in [`apps/frontend-blog/src/app/[locale]/about/page.tsx`](../apps/frontend-blog/src/app/[locale]/about/page.tsx:52) currently has 4 items:
- Flutter, Shorebird, Capacitor, sembast

## Changes Required

### 1. Add 8 React Native items to `techStackGroups` Mobile category

New items to add after existing ones:

| # | Name | Icon | Translation Key |
|---|------|------|-----------------|
| 1 | React Native | 📱 | techReactNative |
| 2 | Redux Toolkit | 🔄 | techReduxToolkit |
| 3 | RTK Query | 🔌 | techRtkQuery |
| 4 | Reanimated | ✨ | techReanimated |
| 5 | React Navigation | 🧭 | techReactNavigation |
| 6 | Gesture Handler | 🤌 | techGestureHandler |
| 7 | MMKV | 💾 | techMmkv |
| 8 | i18next | 🌐 | techI18next |

### 2. Add i18n translation keys in all 6 locale files

Each new item needs a `tech{Name}` key with a description in all files:
- [`apps/frontend-blog/src/messages/en.json`](../apps/frontend-blog/src/messages/en.json) (around line 188)
- [`apps/frontend-blog/src/messages/zh.json`](../apps/frontend-blog/src/messages/zh.json)
- [`apps/frontend-blog/src/messages/ja.json`](../apps/frontend-blog/src/messages/ja.json)
- [`apps/frontend-blog/src/messages/ko.json`](../apps/frontend-blog/src/messages/ko.json)
- [`apps/frontend-blog/src/messages/fr.json`](../apps/frontend-blog/src/messages/fr.json)
- [`apps/frontend-blog/src/messages/de.json`](../apps/frontend-blog/src/messages/de.json)

### 3. Translations table

| Key | en | zh | ja | ko | fr | de |
|-----|----|----|----|----|----|----|
| techReactNative | Cross-platform mobile framework | 跨平台移动框架 | クロスプラットフォームモバイル | 크로스 플랫폼 모바일 | Framework mobile multiplateforme | Plattformübergreifendes Mobile-Framework |
| techReduxToolkit | State management library | 状态管理库 | 状態管理ライブラリ | 상태 관리 라이브러리 | Bibliothèque de gestion d'état | Zustandsverwaltungsbibliothek |
| techRtkQuery | Data fetching and caching | 数据请求与缓存 | データ取得とキャッシュ | 데이터 페칭 및 캐싱 | Récupération et mise en cache de données | Datenabruf und Caching |
| techReanimated | Smooth animation library | 流畅动画库 | スムーズなアニメーション | 부드러운 애니메이션 | Bibliothèque d'animations fluides | Animationsbibliothek |
| techReactNavigation | Navigation framework | 导航框架 | ナビゲーションフレームワーク | 내비게이션 프레임워크 | Framework de navigation | Navigations-Framework |
| techGestureHandler | Gesture handling library | 手势处理库 | ジェスチャー処理 | 제스처 처리 라이브러리 | Bibliothèque de gestion des gestes | Gestenverarbeitungsbibliothek |
| techMmkv | High-perf key-value storage | 高性能键值存储 | 高性能KVストレージ | 고성능 키-값 저장소 | Stockage clé-valeur hautes performances | Hochleistungs-KV-Speicher |
| techI18next | Internationalization framework | 国际化框架 | 国際化フレームワーク | 국제화 프레임워크 | Framework d'internationalisation | Internationalisierungs-Framework |

## Files to Modify

| File | Change |
|------|--------|
| [`apps/frontend-blog/src/app/[locale]/about/page.tsx`](../apps/frontend-blog/src/app/[locale]/about/page.tsx) | Add 8 items to mobile `techStackGroups` array |
| [`apps/frontend-blog/src/messages/en.json`](../apps/frontend-blog/src/messages/en.json) | Add 8 translation keys under `about` section |
| [`apps/frontend-blog/src/messages/zh.json`](../apps/frontend-blog/src/messages/zh.json) | Add 8 translation keys under `about` section |
| [`apps/frontend-blog/src/messages/ja.json`](../apps/frontend-blog/src/messages/ja.json) | Add 8 translation keys under `about` section |
| [`apps/frontend-blog/src/messages/ko.json`](../apps/frontend-blog/src/messages/ko.json) | Add 8 translation keys under `about` section |
| [`apps/frontend-blog/src/messages/fr.json`](../apps/frontend-blog/src/messages/fr.json) | Add 8 translation keys under `about` section |
| [`apps/frontend-blog/src/messages/de.json`](../apps/frontend-blog/src/messages/de.json) | Add 8 translation keys under `about` section |

## Verification
1. Run `yarn workspace @lucky/frontend-blog dev`
2. Visit `/en/about` and scroll to Mobile section
3. Verify 12 items total (4 existing + 8 new) in Mobile category
4. Switch to zh/ja/ko/fr/de locales, verify translations render correctly
