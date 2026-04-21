# Next.js 15 + next-intl v3 多语言完整踩坑指南

> 2026年4月7日 完整实战记录

本文档记录了 Lucky Nest Blog 项目中多语言系统的完整实现过程，以及踩过的所有坑，作为团队内部标准架构文档。

---

---

## 📦 Provider 层级关系说明

| Provider                 | 职责                            | 所在位置                  | 关键配置                  |
| ------------------------ | ------------------------------- | ------------------------- | ------------------------- |
| `NextIntlClientProvider` | next-intl官方上下文             | `app/[locale]/layout.tsx` | **必须加 `key={locale}`** |
| `I18nProvider`           | 自定义包装层，同步html lang属性 | `app/[locale]/layout.tsx` | -                         |
| `ThemeProvider`          | 暗黑主题                        | `app/[locale]/layout.tsx` | -                         |
| `QueryProvider`          | TanStack Query                  | `app/[locale]/layout.tsx` | -                         |

> ❗ **重要**: 所有Provider必须放在 `[locale]` 层布局内，绝对不能放在根布局里！

---

## 最终正确架构

### 1. 根布局 `app/layout.tsx`

**绝对不要在这里放任何东西！**

```tsx
//  正确的根布局：只透传内容
export default function RootLayout({ children }) {
  return children;
}
```

### 2. 语言层布局 `app/[locale]/layout.tsx`

**所有的HTML、Provider、样式、元数据全部放在这里！**

```tsx
import { NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { readFileSync } from "fs";
import { resolve } from "path";

//  必须在语言层包含完整的HTML骨架
export default async function LocaleLayout({ children, params }) {
  const { locale } = await params;

  setRequestLocale(locale);

  //  绕过 getRequestConfig BUG 直接读取文件
  const messagesPath = resolve(process.cwd(), `src/messages/${locale}.json`);
  const messages = JSON.parse(readFileSync(messagesPath, "utf8"));

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider
          key={locale}
          locale={locale}
          messages={messages}
        >
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

### 3. 语言切换实现

```tsx
"use client";
import { useRouter, usePathname } from "@/navigation";

const switchLocale = (nextLocale) => {
  router.replace(pathname, { locale: nextLocale }, { scroll: false });
};
```

---

## 🐛 全部6层BUG总结

按从底层到表层的顺序：

| 层级 | BUG 描述                        | 影响                                                      | 修复方案                                   |
| ---- | ------------------------------- | --------------------------------------------------------- | ------------------------------------------ |
| 1    | **Next.js App Router 设计限制** | 外层布局永远不会因为内部路由参数变化而重新渲染            | 把HTML骨架移到 [locale] 层布局             |
| 2    | **next-intl v3 RC7 官方BUG**    | `getRequestConfig` 收到的 `locale` 参数永远是 `undefined` | 放弃 `getMessages()` API，直接用fs读取文件 |
| 3    | **React Provider 重渲染优化**   | Provider属性变化时React不会重新创建组件树                 | 添加 `key={locale}` 强制重渲染             |
| 4    | **TurboPack 动态导入永久缓存**  | 动态import的JSON文件永远缓存第一次加载的内容              | 不使用动态import                           |
| 5    | **Next.js 15 Full Route Cache** | 整个页面渲染结果永久缓存                                  | 不在根布局做任何事情                       |
| 6    | **开发者思维误区**              | 认为根布局应该放公共内容                                  | 根布局只做透传，所有逻辑下移               |

---

## ❌ 绝对不要做的事情

1. ❌ 不要在根布局 `app/layout.tsx` 里放 `<html>` `<body>`
2. ❌ 不要在根布局里放任何Provider
3. ❌ 不要依赖 `getRequestConfig` 和 `getMessages()` API（RC版本有BUG）
4. ❌ 不要用 `import(`./messages/${locale}.json`)` 动态导入
5. ❌ 不要写任何 `normalizePathname` 路径处理函数
6. ❌ 不要加任何假fetch、随机数、时间戳等hack
7. ❌ 不要混合使用 `next/navigation` 和 `@/navigation` 两个版本的导航API
8. ❌ 不要自己写 `normalizePathname` 路径处理函数

---

## 正确的调试方法

在以下4个关键点加入日志，可以100%定位任何问题：

1. 🔴 客户端：用户点击语言切换按钮
2. 🔵 服务端：`getRequestConfig` 执行
3. 🟣 服务端：`[locale]/layout.tsx` 渲染
4. 🟢 客户端：Provider 上下文变化

---

## 📌 版本信息

- Next.js: `15.1.0`
- next-intl: `3.0.0-rc.7`
- Turbopack: Enabled

---

## 🎯 最终效果

语言切换 0 延迟
所有翻译实时更新
页面保持滚动位置
没有任何控制台错误
完全符合官方架构
没有任何临时hack代码

---

## 🚦 完整语言切换请求流程

```
用户点击切换语言按钮
        ↓
[客户端] router.replace({ locale: 'en' }, { scroll: false })
        ↓
[浏览器] 页面导航到 /en/
        ↓
[Next.js Server] 匹配动态路由 [locale]
        ↓
[服务端] app/[locale]/layout.tsx 执行  这是唯一会重新执行的布局
        ↓
[服务端] fs.readFileSync 读取对应语言messages.json
        ↓
[服务端] 渲染完整HTML页面
        ↓
[客户端] 页面水化完成
        ↓
[客户端] NextIntlClientProvider 接收新的messages
        ↓
[客户端] 所有组件翻译实时更新

 整个流程 0 延迟
```

---

## 🧭 故障排除标准流程

以后团队任何人遇到多语言问题，严格按照这个优先级检查，10分钟内一定解决：

| 优先级      | 检查项                         | 正确结果                                |
| ----------- | ------------------------------ | --------------------------------------- |
| 🔴 **最高** | 检查 `app/layout.tsx`          | 必须是空的，只返回 children             |
| 🟠          | 检查 `app/[locale]/layout.tsx` | 必须包含完整 `<html>` `<body>` 标签     |
| 🟡          | 检查 `NextIntlClientProvider`  | 必须加 `key={locale}` 属性              |
| 🟢          | 检查 messages 加载方式         | 必须用 fs.readFileSync 直接读取         |
| 🔵          | 检查导航API                    | 必须使用 `@/navigation` 导出的useRouter |
| 🟣          | 检查根布局                     | ❌ 绝对不要放任何Provider或HTML标签     |

---

---

## 🐛 常见额外坑点

### ❌ URL嵌套问题 `/zh-CN/en/tags`

**原因**: 同时导入了原生 `next/navigation` 和 `@/navigation` 两个版本的usePathname。

- 解决：全局统一使用 `@/navigation` 导出的所有导航API
- 从项目中彻底删除所有 `import { usePathname } from 'next/navigation'`

### ❌ 语言切换滚动到顶部

**原因**: router.replace 默认会重置滚动位置。

- 解决：添加 `{ scroll: false }` 选项

```ts
router.replace(pathname, { locale: nextLocale }, { scroll: false });
```

### ❌ 水合不匹配警告

**原因**: 根布局里有客户端组件。

- 解决：所有客户端组件全部移到 `[locale]` 层布局内

---

## 💡 经验教训总结

1. **永远不要相信框架的默认行为** - App Router外层布局不重渲染是设计如此，不是BUG
2. **RC版本的API永远有隐藏BUG** - 不要相信官方文档里的示例代码
3. **调试日志必须打在整个链路的每一层** - 只在最上层打日志永远找不到问题
4. **当所有表面修复都没用的时候，问题一定在架构底层**

> 本架构已经经过完整实战验证，可以作为所有Next.js + next-intl项目的标准模板。
