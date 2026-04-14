# 动态语言配置架构设计

> 📅 创建日期: 2026-04-14  
> 🔧 状态: **已更新 - 采用本地文件方案**  
> 🎯 优先级: 最高  
> ⚠️ 难度: 低

## 📋 问题描述

### 当前问题

博客系统存在国际化架构不统一的问题：

1. **配置来源不一致**:
   - admin-next: 从系统配置动态读取启用的语言列表
   - frontend-blog: 硬编码 `['zh-CN', 'en']`，未读取系统配置

2. **语言标识符不一致**:
   - admin-next 使用 `zh` (简体中文)
   - frontend-blog 使用 `zh-CN` (中国简体中文)

3. **缺少统一配置源**:
   - 前端实际支持的语言由消息文件决定
   - 系统配置与前端部署脱节

### 影响范围

- 用户可能看到未启用的语言选项
- 语言切换功能与系统配置不一致
- 无法动态管理前端博客的语言支持
- 系统维护复杂，配置分散

## 🎯 根因分析

### 1. 历史原因

- frontend-blog 项目独立开发，未与admin-next共享语言配置逻辑
- 使用next-intl默认配置，采用了 `zh-CN` 标识符
- 系统配置API最初设计为管理员专用，未考虑公共访问需求

### 2. 技术债务

- 缺少统一的LanguageProvider组件
- 各前端应用独立管理语言配置
- 配置与实际部署的文件脱节

### 3. 架构缺陷

- 系统配置与前端实际支持的语言脱钩
- 前端支持什么语言应由部署的文件决定
- 国际化配置未作为核心基础设施

## ✅ 方案选型

### 方案A：本地文件扫描方案 (最终选择)

**优点**:

- 最简单、最可靠
- 构建时不依赖任何外部服务
- 100%构建稳定性
- 代码量极少，易于维护
- 符合实际：前端支持什么语言由部署的文件决定

**缺点**:

- 需要重新部署来添加新语言
- 管理员启用语言后需要开发者添加消息文件

### 方案B：创建公共API端点 (已实现但弃用)

**优点**:

- 实时性高，管理员启用后立即生效
- 保持API一致性

**缺点**:

- 构建时依赖API可用性
- 增加网络错误处理复杂性
- 实际意义有限：没有消息文件，语言切换不会生效

### 方案C：混合方案 (考虑过)

**优点**:

- 平衡实时性和稳定性
- 部分功能立即可用

**缺点**:

- 实现复杂
- 用户体验不一致
- 维护成本高

**最终选择方案A**：本地文件扫描方案，这是最简单、最符合实际的解决方案。

## 🏗️ 系统架构

### 整体架构（本地文件方案）

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   frontend-blog │    │    admin-next   │    │       API       │
│                 │    │                 │    │                 │
│  文件系统扫描    │    │  useAvailable   │    │  SystemConfig   │
│  src/messages/  │    │    Locales()    │    │    Service      │
│                 │    │                 │    │                 │
└────────┬────────┘    └────────┬────────┘    └────────┬────────┘
         │                      │                      │
         │ 扫描.json文件         │                      │
         ▼                      │                      │
    ┌────────────┐              │                      │
    │ 语言列表   │              │                      │
    │ ['zh','en']│              │                      │
    └────────────┘              │                      │
         │                      │                      │
         └──────────────────────┼──────────────────────┘
                                │
                                ▼
                    ┌─────────────────────┐
                    │  Public API Endpoint│
                    │  /v1/public/system- │
                    │  config/locales     │
                    └─────────────────────┘
```

### 数据流

1. **构建时/运行时**：扫描 `src/messages/` 目录下的 `.json` 文件
2. **提取语言代码**：从文件名提取语言标识符（处理 `zh-CN.json` → `zh` 映射）
3. **验证语言**：检查请求的语言是否在支持列表中
4. **加载消息文件**：加载对应的JSON文件作为翻译内容

### 组件设计

```typescript
// 语言配置接口（简化版）
interface LocaleConfig {
  code: string; // 'zh', 'en', 'ja', 'ko', 'fr', 'de'
  name: string; // '中文', 'English', '日本語'
  nativeName: string; // '简体中文', 'English', '日本語'
  enabled: boolean; // 是否启用（由文件存在决定）
  isDefault: boolean; // 是否为默认语言
}

// 文件到语言的映射配置
const FILE_TO_LOCALE = {
  "zh-CN": "zh", // 文件zh-CN.json对应语言代码zh
  zh: "zh", // 重命名后
  en: "en",
  ja: "ja",
  ko: "ko",
  fr: "fr",
  de: "de",
};

// 语言到文件的映射（反向）
const LOCALE_TO_FILE = Object.entries(FILE_TO_LOCALE).reduce(
  (acc, [file, locale]) => {
    acc[locale] = file;
    return acc;
  },
  {} as Record<string, string>,
);
```

## 🔄 完整工作流程（本地文件方案）

### 1. 构建时/启动时扫描

```
应用启动/构建 → 扫描src/messages/目录 → 获取所有.json文件 → 提取语言代码 → 生成支持的语言列表
```

### 2. 请求处理流程

```
用户请求 /zh 或 /en → i18n.config.ts验证语言 → 检查语言是否在支持列表中 → 加载对应消息文件 → 返回翻译内容
```

### 3. 语言切换流程

```
用户点击语言切换 → 导航到新语言路由 → 服务器验证语言支持 → 加载对应消息文件 → 显示新语言内容
```

### 4. 添加新语言流程

```
管理员在admin-next启用新语言 → 通知开发者 → 开发者创建ja.json消息文件 → 提交代码并部署 → 用户可以使用日语
```

### 5. 错误处理流程

```
请求不支持的语言 → 回退到默认语言(zh) → 加载zh.json消息文件 → 正常显示内容
```

## ⚙️ 技术实现细节（本地文件方案）

### 1. i18n配置实现

#### 1.1 核心i18n.config.ts

```typescript
// apps/frontend-blog/i18n.config.ts
import { getRequestConfig } from "next-intl/server";
import { readdirSync } from "fs";
import { resolve } from "path";

// 文件到语言的映射配置
const FILE_TO_LOCALE = {
  "zh-CN": "zh", // 文件zh-CN.json对应语言代码zh
  zh: "zh", // 重命名后
  en: "en",
  ja: "ja",
  ko: "ko",
  fr: "fr",
  de: "de",
};

// 语言到文件的映射（反向）
const LOCALE_TO_FILE = Object.entries(FILE_TO_LOCALE).reduce(
  (acc, [file, locale]) => {
    acc[locale] = file;
    return acc;
  },
  {} as Record<string, string>,
);

/**
 * 获取支持的语言列表
 * 通过扫描src/messages/目录下的.json文件
 */
function getAvailableLocales(): string[] {
  const messagesDir = resolve(process.cwd(), "src/messages");
  try {
    const files = readdirSync(messagesDir);
    const locales = files
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.replace(".json", ""))
      .map((fileCode) => FILE_TO_LOCALE[fileCode] || fileCode);

    // 去重（可能多个文件映射到同一个语言）
    return [...new Set(locales)];
  } catch (error) {
    console.warn("Failed to scan messages directory, using defaults:", error);
    return ["zh", "en"]; // 默认回退
  }
}

export default getRequestConfig(async ({ locale }) => {
  const availableLocales = getAvailableLocales();

  // 验证语言是否支持
  if (!availableLocales.includes(locale)) {
    // 回退到默认语言
    locale = "zh";
  }

  // 获取对应的文件名
  const fileCode = LOCALE_TO_FILE[locale] || locale;

  try {
    const messages = (await import(`./src/messages/${fileCode}.json`)).default;
    return {
      locale,
      messages,
    };
  } catch (error) {
    // 文件加载失败，回退到默认语言
    console.warn(
      `Failed to load messages for ${locale}, falling back to zh:`,
      error,
    );

    const defaultFileCode = LOCALE_TO_FILE["zh"] || "zh";
    const defaultMessages = (
      await import(`./src/messages/${defaultFileCode}.json`)
    ).default;
    return {
      locale: "zh",
      messages: defaultMessages,
    };
  }
});
```

#### 1.2 简化版useAvailableLocales Hook

```typescript
// apps/frontend-blog/src/lib/hooks/useAvailableLocales.ts (简化版)
"use client";

import { useMemo } from "react";

// 静态语言配置（基于实际部署的文件）
const STATIC_LOCALES = [
  {
    code: "zh",
    name: "中文",
    nativeName: "简体中文",
    enabled: true,
    isDefault: true,
  },
  {
    code: "en",
    name: "English",
    nativeName: "English",
    enabled: true,
    isDefault: false,
  },
  // 未来添加更多语言时，需要同时添加对应的消息文件
];

export function useAvailableLocales() {
  return useMemo(() => {
    const enabledLocales = STATIC_LOCALES.filter((l) => l.enabled);

    return {
      locales: STATIC_LOCALES,
      enabledLocales,
      isEnabled: (code: string) =>
        STATIC_LOCALES.find((l) => l.code === code)?.enabled ?? false,
      loading: false,
      error: null,
    };
  }, []);
}
```

### 2. 统一语言标识符

#### 2.1 重命名消息文件

```bash
# 将 zh-CN.json 重命名为 zh.json
mv apps/frontend-blog/src/messages/zh-CN.json apps/frontend-blog/src/messages/zh.json
```

#### 2.2 更新Header组件

```typescript
// apps/frontend-blog/src/components/Header.tsx (简化版)
'use client';

import { useAvailableLocales } from '@/lib/hooks/useAvailableLocales';

export default function Header() {
  const { enabledLocales } = useAvailableLocales();
  const locale = useLocale() as string;

  // 语言切换函数
  const switchLocale = (nextLocale: string) => {
    router.replace(pathname, { locale: nextLocale });
    setLangMenuOpen(false);
  };

  return (
    <header>
      {/* 语言切换下拉菜单 */}
      <div className="relative">
        <button onClick={() => setLangMenuOpen(!langMenuOpen)}>
          <Globe className="h-5 w-5" />
          <span className="text-xs font-medium">
            {locale === 'zh' ? '中文' : locale.toUpperCase()}
          </span>
        </button>

        {langMenuOpen && (
          <div className="absolute right-0 mt-2 w-32 rounded-md border bg-popover shadow-lg">
            {enabledLocales.map((lang) => (
              <button
                key={lang.code}
                onClick={() => switchLocale(lang.code)}
                className={`w-full px-4 py-2 text-left text-sm hover:bg-accent transition-colors ${
                  locale === lang.code ? 'bg-accent text-primary' : ''
                }`}
              >
                {lang.nativeName}
              </button>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}
```

#### 2.3 更新导航配置

```typescript
// apps/frontend-blog/src/navigation.ts
import { createSharedPathnamesNavigation } from "next-intl/navigation";

// 静态语言列表（基于实际部署的文件）
export const LOCALES = ["zh", "en"];

export const { Link, redirect, usePathname, useRouter } =
  createSharedPathnamesNavigation({
    locales: LOCALES,
    localePrefix: "always",
  });
```

### 3. 添加新语言的工作流程

#### 3.1 管理员操作

1. 在admin-next中启用新语言（如日语）
2. 系统提示："请在前端添加对应的消息文件 ja.json"

#### 3.2 开发者操作

```bash
# 1. 创建日语消息文件模板
cp apps/frontend-blog/src/messages/en.json apps/frontend-blog/src/messages/ja.json

# 2. 编辑ja.json文件，添加日语翻译
# 3. 提交代码并部署
```

#### 3.3 部署后

- 用户可以看到日语选项
- 点击日语切换可以正常显示日语内容

## 📊 成本与性能（本地文件方案）

### 性能优势

#### 1. 零网络延迟

- **文件系统扫描**: 本地文件读取，毫秒级响应
- **无API依赖**: 构建和运行时都不需要网络请求
- **内存缓存**: 扫描结果可以缓存在内存中

#### 2. 构建稳定性

- **100%可靠**: 不依赖任何外部服务
- **可重复构建**: 相同的代码总是产生相同的结果
- **离线构建**: 可以在无网络环境下构建

#### 3. 运行时性能

- **首次扫描**: 应用启动时扫描一次目录
- **内存缓存**: 扫描结果缓存在内存中
- **零运行时开销**: 后续请求直接使用缓存结果

### 成本分析

#### 开发成本

- **i18n配置修改**: 1小时 (实现文件扫描逻辑)
- **消息文件重命名**: 30分钟 (zh-CN.json → zh.json)
- **组件更新**: 1小时 (更新Header和导航配置)
- **测试验证**: 30分钟
- **总计**: 3小时 (比API方案减少50%)

#### 运维成本

- **零运维**: 不需要监控API端点
- **零网络成本**: 没有API调用流量
- **零缓存成本**: 不需要Redis缓存

#### 风险成本

- **向后兼容**: 需要处理zh-CN到zh的迁移
- **文件系统权限**: 确保应用有读取文件目录的权限
- **部署同步**: 管理员启用语言后需要开发者添加消息文件

### 性能对比

| 指标           | 本地文件方案 | API动态方案         |
| -------------- | ------------ | ------------------- |
| **构建时间**   | ✅ 无变化    | ⚠️ 增加API调用时间  |
| **运行时性能** | ✅ 毫秒级    | ⚠️ 网络延迟+API处理 |
| **可靠性**     | ✅ 100%      | ⚠️ 依赖网络和API    |
| **离线支持**   | ✅ 完全支持  | ❌ 需要网络         |
| **运维复杂度** | ✅ 极低      | ⚠️ 中等             |

### 扩展性考虑

#### 支持大量语言

- **文件扫描性能**: 即使有100个语言文件，扫描也是毫秒级
- **内存占用**: 语言列表很小，内存占用可忽略
- **构建时间**: 不受语言数量影响

#### 动态更新需求

- **添加新语言**: 需要重新部署（这是合理的，因为需要翻译内容）
- **禁用语言**: 可以保留文件，前端不显示选项
- **紧急修复**: 可以通过部署快速修复

## 🧪 测试方案（本地文件方案）

### 单元测试

```typescript
// 测试文件扫描功能
describe("getAvailableLocales", () => {
  it("应该从messages目录扫描语言文件", () => {
    // 模拟文件系统
    const mockFiles = ["zh.json", "en.json", "ja.json"];
    jest.spyOn(fs, "readdirSync").mockReturnValue(mockFiles as any);

    const locales = getAvailableLocales();
    expect(locales).toEqual(["zh", "en", "ja"]);
  });

  it("应该处理zh-CN到zh的映射", () => {
    const mockFiles = ["zh-CN.json", "en.json"];
    jest.spyOn(fs, "readdirSync").mockReturnValue(mockFiles as any);

    const locales = getAvailableLocales();
    expect(locales).toEqual(["zh", "en"]);
  });

  it("文件扫描失败时应该返回默认语言", () => {
    jest.spyOn(fs, "readdirSync").mockImplementation(() => {
      throw new Error("Permission denied");
    });

    const locales = getAvailableLocales();
    expect(locales).toEqual(["zh", "en"]);
  });
});

// 测试useAvailableLocales hook
describe("useAvailableLocales", () => {
  it("应该返回静态语言配置", () => {
    const { result } = renderHook(() => useAvailableLocales());
    expect(result.current.loading).toBe(false);
    expect(result.current.enabledLocales.length).toBe(2);
    expect(result.current.enabledLocales[0].code).toBe("zh");
    expect(result.current.enabledLocales[1].code).toBe("en");
  });

  it("应该正确判断语言是否启用", () => {
    const { result } = renderHook(() => useAvailableLocales());
    expect(result.current.isEnabled("zh")).toBe(true);
    expect(result.current.isEnabled("en")).toBe(true);
    expect(result.current.isEnabled("ja")).toBe(false); // 未添加ja.json
  });
});
```

### 集成测试

```typescript
// 测试i18n.config.ts语言验证
describe("i18n.config.ts language validation", () => {
  it("应该支持存在的语言", async () => {
    const mockFiles = ["zh.json", "en.json"];
    jest.spyOn(fs, "readdirSync").mockReturnValue(mockFiles as any);

    const config = await getRequestConfig({ locale: "zh" });
    expect(config.locale).toBe("zh");
  });

  it("不支持的语言应该回退到默认语言", async () => {
    const mockFiles = ["zh.json", "en.json"];
    jest.spyOn(fs, "readdirSync").mockReturnValue(mockFiles as any);

    const config = await getRequestConfig({ locale: "ja" }); // 日语不存在
    expect(config.locale).toBe("zh"); // 回退到中文
  });

  it("文件加载失败应该回退到默认语言", async () => {
    const mockFiles = ["zh.json", "en.json"];
    jest.spyOn(fs, "readdirSync").mockReturnValue(mockFiles as any);
    jest
      .spyOn(require, "import")
      .mockRejectedValue(new Error("File not found"));

    const config = await getRequestConfig({ locale: "en" });
    expect(config.locale).toBe("zh"); // 回退到中文
  });
});
```

### E2E测试

```typescript
// 测试前端语言切换
describe("语言切换功能", () => {
  it("应该显示支持的语言选项", async () => {
    await page.goto("/zh");
    await page.click('[data-testid="language-switcher"]');
    const languageOptions = await page.$$('[data-testid="language-option"]');
    expect(languageOptions.length).toBe(2); // zh和en
  });

  it("应该能切换到英文", async () => {
    await page.goto("/zh");
    await page.click('[data-testid="language-switcher"]');
    await page.click("text=English");
    await expect(page).toHaveURL("/en");
    // 验证页面内容显示英文
    await expect(page.locator("h1")).toContainText("Welcome");
  });

  it("不支持的语言应该回退到默认语言", async () => {
    // 直接访问不存在的语言
    await page.goto("/ja");
    // 应该自动重定向到默认语言
    await expect(page).toHaveURL("/zh");
  });
});
```

### 部署验证测试

```typescript
// 测试新语言添加流程
describe("添加新语言流程", () => {
  it("添加ja.json后应该显示日语选项", async () => {
    // 模拟添加日语文件
    const mockFiles = ["zh.json", "en.json", "ja.json"];
    jest.spyOn(fs, "readdirSync").mockReturnValue(mockFiles as any);

    const locales = getAvailableLocales();
    expect(locales).toContain("ja");

    // 验证日语可以被访问
    const config = await getRequestConfig({ locale: "ja" });
    expect(config.locale).toBe("ja");
  });
});
```

## 📅 实施计划（本地文件方案）

### 阶段一：核心i18n配置改造 (1小时)

1. **修改 `i18n.config.ts`**：实现本地文件扫描逻辑
2. **重命名消息文件**：`zh-CN.json` → `zh.json`
3. **更新语言映射配置**：处理文件到语言的映射关系

### 阶段二：组件更新 (1小时)

1. **更新 `Header.tsx`**：使用简化的 `useAvailableLocales` hook
2. **更新 `navigation.ts`**：使用静态语言列表 `['zh', 'en']`
3. **更新其他相关组件**：统一使用 `'zh'` 而不是 `'zh-CN'`

### 阶段三：测试验证 (30分钟)

1. **单元测试**：测试文件扫描和语言验证逻辑
2. **集成测试**：测试i18n配置的语言回退机制
3. **手动测试**：验证语言切换功能正常工作

### 阶段四：部署和监控 (30分钟)

1. **代码审查和合并**
2. **部署到开发环境**：验证功能正常
3. **部署到生产环境**：分阶段部署
4. **监控验证**：确保没有回归问题

### 阶段五：文档和流程完善 (1小时，可选)

1. **更新管理员界面提示**：添加"需要添加消息文件"的提示
2. **创建消息文件生成脚本**：`yarn generate:locale <code>`
3. **更新CI/CD检查**：验证启用的语言是否有对应的消息文件
4. **更新相关文档**：说明新的工作流程

## 🔄 回滚计划（本地文件方案）

### 代码回滚

```bash
# 回滚到修改前的版本
git revert <commit-hash>
# 或者使用标签回滚
git checkout tags/v1.0.0-before-i18n-refactor
```

### 文件回滚

```bash
# 恢复消息文件名称（如果需要）
mv apps/frontend-blog/src/messages/zh.json apps/frontend-blog/src/messages/zh-CN.json

# 恢复原始的i18n.config.ts
git checkout HEAD -- apps/frontend-blog/i18n.config.ts
```

### 配置回滚

```typescript
// 恢复Header.tsx中的语言标识符
// 将 'zh' 改回 'zh-CN'
const locale = useLocale() as "zh-CN" | "en";
const switchLocale = (nextLocale: "zh-CN" | "en") => {
  router.replace(pathname, { locale: nextLocale });
};
```

### 数据库回滚（如果需要）

```sql
-- 恢复系统配置（如果需要）
UPDATE system_configs
SET value = JSON.stringify(['zh-CN', 'en'])
WHERE key = 'enabled_locales';
```

## 📚 相关文档

- [国际化架构改造计划](../plans/BLOG_ISSUES_FIX_PLAN.md#4-国际化架构统一问题)
- [系统配置管理指南](../../CLIENT_SYSTEM_CONFIG_IMPLEMENTATION.md)
- [next-intl v4.9.0 配置指南](I18N_NEXT_INTL_V3_FULL_GUIDE.md)
- [TanStack Query 使用指南](../../../nextjs/PROVIDERS_GUIDE.md)

## 👥 责任分配
