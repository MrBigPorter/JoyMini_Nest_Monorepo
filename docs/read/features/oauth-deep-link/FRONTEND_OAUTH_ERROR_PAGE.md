# 前端 OAuth 错误页面实现指南

## 📄 需求背景

后端 OAuth 错误处理已修复（2026-04-04），当 OAuth 登录失败时会重定向到：

```
https://admin.joyminis.com/oauth-error?code=PROVIDER_ERROR&provider=facebook&message=...
```

前端需要创建 `/oauth-error` 页面展示用户友好的错误信息。

---

## 🎯 功能需求

### 1. URL 参数

| 参数       | 类型   | 说明                           | 示例                                                      |
| ---------- | ------ | ------------------------------ | --------------------------------------------------------- |
| `code`     | string | 错误代码                       | `PROVIDER_ERROR`, `NETWORK_ERROR`, `INVALID_STATE`        |
| `provider` | string | OAuth 提供商                   | `google`, `facebook`, `apple`                             |
| `message`  | string | 用户友好的错误消息（URL 编码） | `Third-party login service is temporarily unavailable...` |

### 2. 错误代码映射

后端定义的错误代码（`apps/api/src/common/oauth/oauth-errors.ts`）：

```typescript
const OAUTH_ERROR_MESSAGES = {
  INVALID_STATE: "Login session has expired, please log in again",
  PROVIDER_ERROR:
    "Third-party login service is temporarily unavailable, please try again later",
  NETWORK_ERROR: "Network connection failed, please check network settings",
  USER_CANCELLED: "Login cancelled", // ← 注：取消时不会到此页面，而是重定向到 /login?cancelled=true
  INVALID_CALLBACK: "Callback URL is invalid",
  TOKEN_EXPIRED: "Login credentials have expired, please log in again",
  DEFAULT: "An error occurred during login, please try again later",
};
```

### 3. 用户体验要求

- 显示清晰的错误消息（优先使用 URL 中的 `message` 参数）
- 展示发生错误的 OAuth 提供商图标/名称（Google/Facebook/Apple）
- 提供"返回登录"按钮
- 自动在 5 秒后跳转回登录页（可选）
- **处理 `#_=_` fragment**（Facebook 老版 SDK 遗留问题）

---

## 💻 实现示例

### Next.js 15 App Router 实现

#### 1. 创建页面文件

```typescript
// apps/admin-next/src/app/oauth-error/page.tsx
'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@ui/components/button';
import { AlertCircle, RefreshCw } from 'lucide-react';

const PROVIDER_NAMES: Record<string, string> = {
  google: 'Google',
  facebook: 'Facebook',
  apple: 'Apple',
};

export default function OAuthErrorPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [countdown, setCountdown] = useState(5);

  const code = searchParams.get('code');
  const provider = searchParams.get('provider');
  const message = searchParams.get('message');

  // 清理 Facebook 遗留的 #_=_ fragment
  useEffect(() => {
    if (window.location.hash === '#_=_') {
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search
      );
    }
  }, []);

  // 自动倒计时跳转
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          router.push('/login');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [router]);

  const providerName = provider ? PROVIDER_NAMES[provider] || provider : 'OAuth';

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-lg">
        {/* 错误图标 */}
        <div className="flex justify-center mb-6">
          <div className="rounded-full bg-red-100 p-4">
            <AlertCircle className="h-12 w-12 text-red-600" />
          </div>
        </div>

        {/* 标题 */}
        <h1 className="text-2xl font-bold text-center text-gray-900 mb-4">
          {providerName} 登录失败
        </h1>

        {/* 错误消息 */}
        <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-6">
          <p className="text-sm text-red-800 text-center">
            {decodeURIComponent(message || '登录过程中发生错误，请重试')}
          </p>
          {code && (
            <p className="text-xs text-red-600 text-center mt-2">
              错误代码: {code}
            </p>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="space-y-3">
          <Button
            onClick={() => router.push('/login')}
            className="w-full"
            size="lg"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            返回登录页
          </Button>

          <p className="text-sm text-gray-500 text-center">
            {countdown} 秒后自动跳转...
          </p>
        </div>

        {/* 帮助链接（可选） */}
        <div className="mt-6 text-center">
          <a
            href="/help/oauth-troubleshooting"
            className="text-sm text-blue-600 hover:underline"
          >
            遇到问题？查看帮助文档
          </a>
        </div>
      </div>
    </div>
  );
}
```

#### 2. 多语言支持（可选）

如果项目已有国际化，在 `src/constants.ts` 添加翻译：

```typescript
// src/constants.ts
export const translations = {
  en: {
    oauth: {
      error: {
        title: "{provider} Login Failed",
        returnToLogin: "Return to Login",
        autoRedirect: "Redirecting in {seconds} seconds...",
        help: "Need help? View troubleshooting guide",
      },
    },
  },
  zh: {
    oauth: {
      error: {
        title: "{provider} 登录失败",
        returnToLogin: "返回登录页",
        autoRedirect: "{seconds} 秒后自动跳转...",
        help: "遇到问题？查看帮助文档",
      },
    },
  },
};
```

---

## 🧪 测试场景

### 1. 手动测试

在浏览器地址栏直接访问（模拟后端重定向）：

```bash
# 测试 PROVIDER_ERROR
https://admin-dev.joyminis.com/oauth-error?code=PROVIDER_ERROR&provider=facebook&message=Third-party%20login%20service%20is%20temporarily%20unavailable

# 测试 NETWORK_ERROR
https://admin-dev.joyminis.com/oauth-error?code=NETWORK_ERROR&provider=google&message=Network%20connection%20failed

# 测试 INVALID_STATE
https://admin-dev.joyminis.com/oauth-error?code=INVALID_STATE&provider=apple&message=Login%20session%20has%20expired
```

### 2. E2E 测试

```typescript
// apps/admin-next/playwright/oauth-error.spec.ts
import { test, expect } from "@playwright/test";

test.describe("OAuth Error Page", () => {
  test("should display error message from URL params", async ({ page }) => {
    await page.goto(
      "/oauth-error?code=PROVIDER_ERROR&provider=facebook&message=Service%20unavailable",
    );

    // 验证标题
    await expect(page.locator("h1")).toContainText("Facebook 登录失败");

    // 验证错误消息
    await expect(page.locator("text=Service unavailable")).toBeVisible();

    // 验证错误代码
    await expect(page.locator("text=错误代码: PROVIDER_ERROR")).toBeVisible();
  });

  test("should redirect to login after countdown", async ({ page }) => {
    await page.goto("/oauth-error?code=NETWORK_ERROR&provider=google");

    // 等待 5 秒自动跳转
    await page.waitForURL("/login", { timeout: 6000 });
  });

  test("should handle manual return to login", async ({ page }) => {
    await page.goto("/oauth-error?code=INVALID_STATE&provider=apple");

    // 点击返回登录按钮
    await page.click("text=返回登录页");

    // 验证跳转到登录页
    await expect(page).toHaveURL("/login");
  });

  test("should clean up Facebook #_=_ fragment", async ({ page }) => {
    await page.goto("/oauth-error?code=TEST&provider=facebook#_=_");

    // 等待 fragment 被清理
    await page.waitForTimeout(100);

    // 验证 URL 不包含 #_=_
    const url = page.url();
    expect(url).not.toContain("#_=_");
  });
});
```

---

## 🔗 集成到登录页面

在 `/login` 页面也需要处理 `?cancelled=true` 参数：

```typescript
// apps/admin-next/src/app/login/page.tsx
"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { toast } from "@ui/components/toast";

export default function LoginPage() {
  const searchParams = useSearchParams();
  const cancelled = searchParams.get("cancelled");
  const provider = searchParams.get("provider");

  useEffect(() => {
    // 清理 Facebook fragment
    if (window.location.hash === "#_=_") {
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }

    // 显示取消提示
    if (cancelled === "true" && provider) {
      const providerName = PROVIDER_NAMES[provider] || provider;
      toast.info(`您已取消 ${providerName} 登录`);
    }
  }, [cancelled, provider]);

  // ... 其他登录页面逻辑
}
```

---

## 📊 错误监控（可选）

在 OAuth 错误页面发送错误事件到分析平台：

```typescript
// apps/admin-next/src/app/oauth-error/page.tsx
import { useEffect } from "react";
import { analytics } from "@/lib/analytics"; // 假设已有分析工具

useEffect(() => {
  // 上报 OAuth 错误事件
  if (code && provider) {
    analytics.track("oauth_error", {
      error_code: code,
      provider: provider,
      message: message,
      timestamp: new Date().toISOString(),
    });
  }
}, [code, provider, message]);
```

---

## 🚀 部署检查清单

- [ ] `/oauth-error` 页面创建完成
- [ ] `/login` 页面处理 `?cancelled=true` 参数
- [ ] 清理 `#_=_` fragment 逻辑已实现
- [ ] E2E 测试通过
- [ ] 多语言翻译（如有）
- [ ] 错误监控集成（可选）
- [ ] 验证与后端对接（访问 `https://dev-api.joyminis.com/auth/facebook/callback?error=access_denied` 验证重定向）

---

## 📝 相关文档

- [OAuth 取消/错误修复说明](./OAUTH_CANCEL_FIX_20260404.md)
- [后端 OAuth Deep Link 技术规范](./BACKEND_OAUTH_DEEP_LINK_TECHNICAL_SPEC.md)
- [后端 OAuth 错误处理](../../../apps/api/src/common/oauth/oauth-errors.ts)
