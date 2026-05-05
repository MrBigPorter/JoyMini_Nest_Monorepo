# 计划：admin-next Header + Sidebar 残留硬编码字符串国际化

## 概述
`admin-next` app 的 Header（头像下拉框 toast）和 Sidebar（右下角 logout、折叠按钮）仍有一些硬编码英文。本计划将其全部替换为 `t()` 调用，并补全所有语言文件的 i18n 键。

---

## Step 1: Header.tsx — 替换 toast 消息和 fallback name

**文件**: [`apps/admin-next/src/components/layout/Header.tsx`](apps/admin-next/src/components/layout/Header.tsx)

### 1a: Toast 消息（第 220-221 行）
```typescript
// 修改前
onSuccess: () => addToast('info', 'Logged out successfully'),
onError: (error) => addToast('error', `Logout failed: ${error.message}`),

// 修改后
onSuccess: () => addToast('info', t('header_loggedOut')),
onError: (error) =>
  addToast('error', t('header_logoutFailed', { message: error.message })),
```

### 1b: DisplayName fallback（第 251 行）
```typescript
// 修改前
const displayName = userInfo?.realName || userInfo?.username || 'Admin';
// 修改后
const displayName = userInfo?.realName || userInfo?.username || t('user_fallbackName');
```

---

## Step 2: Sidebar.tsx — 替换 toast 消息 + 硬编码文本

**文件**: [`apps/admin-next/src/components/layout/Sidebar.tsx`](apps/admin-next/src/components/layout/Sidebar.tsx)

### 2a: Toast 消息（第 95-96 行）
```typescript
// 修改前
onSuccess: () => addToast('info', 'Logged out successfully'),
onError: (error) => addToast('error', `Logout failed: ${error.message}`),

// 修改后
onSuccess: () => addToast('info', t('header_loggedOut')),
onError: (error) =>
  addToast('error', t('header_logoutFailed', { message: error.message })),
```

### 2b: 折叠按钮 title（第 220 行）
```typescript
// 修改前
title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
// 修改后
title={isSidebarCollapsed ? t('sidebar_expand') : t('sidebar_collapse')}
```

### 2c: 折叠按钮文字（第 237 行）
```typescript
// 修改前
Collapse
// 修改后
{t('sidebar_collapse')}
```

### 2d: Logout loading 状态（第 258 行）
```typescript
// 修改前
{isLoggingOut ? 'Logging out…' : t('logout')}
// 修改后
{isLoggingOut ? t('header_loggingOut') : t('logout')}
```

---

## Step 3: 补全 en.json 新增键

**文件**: [`apps/admin-next/src/i18n/en.json`](apps/admin-next/src/i18n/en.json)

在 `header_loggingOut` 之后添加：
```json
"header_loggedOut": "Logged out successfully",
"header_logoutFailed": "Logout failed: {message}",
"user_fallbackName": "Admin",
"sidebar_collapse": "Collapse sidebar",
"sidebar_expand": "Expand sidebar"
```

---

## Step 4-8: 补全 zh.json, ja.json, fr.json, ko.json, de.json

用相同结构添加以上 5 个键的中文、日语、法语、韩语、德语翻译。

### zh.json
```json
"header_loggedOut": "已退出登录",
"header_logoutFailed": "退出登录失败：{message}",
"user_fallbackName": "管理员",
"sidebar_collapse": "收起侧栏",
"sidebar_expand": "展开侧栏"
```

### ja.json
```json
"header_loggedOut": "ログアウトしました",
"header_logoutFailed": "ログアウト失敗：{message}",
"user_fallbackName": "管理者",
"sidebar_collapse": "サイドバーを折りたたむ",
"sidebar_expand": "サイドバーを展開"
```

### fr.json
```json
"header_loggedOut": "Déconnecté avec succès",
"header_logoutFailed": "Échec de la déconnexion : {message}",
"user_fallbackName": "Administrateur",
"sidebar_collapse": "Réduire la barre latérale",
"sidebar_expand": "Développer la barre latérale"
```

### ko.json
```json
"header_loggedOut": "로그아웃되었습니다",
"header_logoutFailed": "로그아웃 실패: {message}",
"user_fallbackName": "관리자",
"sidebar_collapse": "사이드바 접기",
"sidebar_expand": "사이드바 펼치기"
```

### de.json
```json
"header_loggedOut": "Erfolgreich abgemeldet",
"header_logoutFailed": "Abmeldung fehlgeschlagen: {message}",
"user_fallbackName": "Administrator",
"sidebar_collapse": "Seitenleiste einklappen",
"sidebar_expand": "Seitenleiste ausklappen"
```

---

## Step 9: 验证

```bash
# Prettier
yarn workspace @lucky/admin-next prettier --write src/components/layout/Header.tsx src/components/layout/Sidebar.tsx src/i18n/*.json

# TypeScript
yarn workspace @lucky/admin-next type-check
```

---

## 涉及文件清单

| # | 文件 | 修改内容 |
|---|------|---------|
| 1 | `apps/admin-next/src/components/layout/Header.tsx` | 3 处：toast × 2 + fallback name |
| 2 | `apps/admin-next/src/components/layout/Sidebar.tsx` | 4 处：toast × 2 + title + text + loading |
| 3 | `apps/admin-next/src/i18n/en.json` | 新增 5 个键 |
| 4 | `apps/admin-next/src/i18n/zh.json` | 新增 5 个键 |
| 5 | `apps/admin-next/src/i18n/ja.json` | 新增 5 个键 |
| 6 | `apps/admin-next/src/i18n/fr.json` | 新增 5 个键 |
| 7 | `apps/admin-next/src/i18n/ko.json` | 新增 5 个键 |
| 8 | `apps/admin-next/src/i18n/de.json` | 新增 5 个键 |

共 **8 个文件**，**2 个 TSX 组件 + 6 个 JSON 语言文件**。
