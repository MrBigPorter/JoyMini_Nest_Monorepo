# Blog Settings Isolation Plan

## Problem

Blog Settings page shares data with admin-next:

1. `general` tab shows all system configs (including admin-next's exchange_rate, kyc, etc.)
2. Locale toggling is global — blog enabling a language affects admin-next

## Solution

Use `blog.` key prefix convention to isolate blog settings from admin-next. Only add blog-specific endpoints, don't touch admin-next.

---

### Step 1: Backend — Add blog-specific locale endpoints

**File: [`apps/api/src/admin/system-config/system-config.service.ts`](../apps/api/src/admin/system-config/system-config.service.ts)**

Add two new methods using key `blog.enabled_locales`:

```typescript
async getBlogLocales() {
  const enabledCodes = await this.get<string[]>('blog.enabled_locales', ['zh', 'en']);
  const ALL_LOCALES = [
    { code: 'zh', name: '中文', nativeName: '简体中文', isDefault: true },
    { code: 'en', name: 'English', nativeName: 'English', isDefault: false },
    { code: 'ja', name: '日本語', nativeName: '日本語', isDefault: false },
    { code: 'ko', name: '한국어', nativeName: '한국어', isDefault: false },
    { code: 'fr', name: 'Français', nativeName: 'Français', isDefault: false },
    { code: 'de', name: 'Deutsch', nativeName: 'Deutsch', isDefault: false },
  ];
  return {
    list: ALL_LOCALES.map((locale) => ({ ...locale, enabled: enabledCodes.includes(locale.code) })),
  };
}

async toggleBlogLocale(code: string, enabled: boolean) {
  const enabledCodes = await this.get<string[]>('blog.enabled_locales', ['zh', 'en']);
  if (code === 'zh') return { success: true };
  const newEnabledCodes = enabled
    ? [...new Set([...enabledCodes, code])]
    : enabledCodes.filter((c) => c !== code);
  await this.prisma.systemConfig.upsert({
    where: { key: 'blog.enabled_locales' },
    create: { key: 'blog.enabled_locales', value: JSON.stringify(newEnabledCodes) },
    update: { value: JSON.stringify(newEnabledCodes) },
  });
  if (enabled) {
    this.eventEmitter.emitAsync('locale.enabled', code).catch(() => {});
  }
  return { success: true };
}
```

**File: [`apps/api/src/admin/system-config/system-config.controller.ts`](../apps/api/src/admin/system-config/system-config.controller.ts)**

Add routes:

```typescript
@Get('blog/locales')
@Roles(Role.SUPER_ADMIN, Role.ADMIN)
getBlogLocales() {
  return this.service.getBlogLocales();
}

@Patch('blog/locales/:code')
@Roles(Role.SUPER_ADMIN, Role.ADMIN)
toggleBlogLocale(@Param('code') code: string, @Body() body: { enabled: boolean }) {
  return this.service.toggleBlogLocale(code, body.enabled);
}
```

---

### Step 2: Frontend — Update API client

**File: [`apps/admin-blog/src/api/index.ts`](../apps/admin-blog/src/api/index.ts)**

Add new methods to `systemConfigApi`:

```typescript
getBlogLocales: () =>
  client.get<{ list: Array<{ code: string; name: string; nativeName: string; enabled: boolean; isDefault: boolean }> }>('/v1/admin/system-config/blog/locales'),

toggleBlogLocale: (code: string, enabled: boolean) =>
  client.patch(`/v1/admin/system-config/blog/locales/${code}`, { enabled }),
```

---

### Step 3: Frontend — Update SettingsClient.tsx

**File: [`apps/admin-blog/src/components/settings/SettingsClient.tsx`](../apps/admin-blog/src/components/settings/SettingsClient.tsx)**

Two changes:

**3a. General tab**: Filter by `blog.` prefix

```typescript
const blogConfigs = configs.filter((c) => c.key.startsWith("blog."));
```

**3b. LocaleSettingsContent**: Replace `useAvailableLocales()` with `systemConfigApi.getBlogLocales()` + `systemConfigApi.toggleBlogLocale()`

---

### Files Modified (4 total, admin-next untouched)

| #   | File                                                           | Complexity |
| --- | -------------------------------------------------------------- | ---------- |
| 1   | `apps/api/src/admin/system-config/system-config.service.ts`    | Low        |
| 2   | `apps/api/src/admin/system-config/system-config.controller.ts` | Low        |
| 3   | `apps/admin-blog/src/api/index.ts`                             | Low        |
| 4   | `apps/admin-blog/src/components/settings/SettingsClient.tsx`   | Low        |

No Prisma migration needed (key-value storage, just new key names).
