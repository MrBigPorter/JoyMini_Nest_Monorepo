# HyperPush — 项目搭建指南

> 按步骤执行，每一步完成后再进入下一步。

## 前置条件

```bash
# 需要已安装 Node.js 18+ 和 yarn
node --version   # 需要 v18+
yarn --version   # 需要 v1.22+
```

---

## 第 1 步：创建项目目录

```bash
cd /Volumes/MySSD/work
mkdir HyperPush
cd HyperPush
```

---

## 第 2 步：初始化项目

```bash
yarn init -y
```

---

## 第 3 步：安装后端依赖

```bash
# NestJS 核心
yarn add @nestjs/core @nestjs/common @nestjs/platform-express reflect-metadata rxjs

# GraphQL（已确认使用 GraphQL）
yarn add @nestjs/graphql @nestjs/apollo @apollo/server graphql

# Prisma ORM
yarn add @prisma/client
yarn add -D prisma

# 认证
yarn add @nestjs/jwt @nestjs/passport passport passport-jwt bcryptjs
yarn add -D @types/passport-jwt @types/bcryptjs

# 验证
yarn add class-validator class-transformer

# 配置
yarn add @nestjs/config

# 环境变量
yarn add dotenv
```

---

## 第 4 步：安装前端依赖

```bash
# Vite + React 19
yarn add -D vite @vitejs/plugin-react

# React
yarn add react react-dom
yarn add -D @types/react @types/react-dom

# TanStack Router
yarn add @tanstack/react-router

# Redux Toolkit + RTK
yarn add @reduxjs/toolkit react-redux

# TanStack Query
yarn add @tanstack/react-query

# GraphQL 客户端（Apollo Client）
yarn add @apollo/client graphql

# i18next
yarn add i18next react-i18next

# Tailwind CSS 4
yarn add tailwindcss @tailwindcss/postcss autoprefixer

# Shadcn/ui
yarn add -D @shadcn/ui
npx shadcn@latest init
```

---

## 第 5 步：配置 Biome

```bash
yarn add -D @biomejs/biome
npx biome init
```

编辑 `biome.json`：

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "organizeImports": { "enabled": true },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "complexity": { "noBannedTypes": "off" }
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "semicolons": "always"
    }
  }
}
```

---

## 第 6 步：配置 Tailwind CSS 4

> ⚠️ 参考项目现有配置：参见 [`apps/admin-next/postcss.config.mjs`](apps/admin-next/postcss.config.mjs) 和 [`apps/admin-next/src/app/globals.css`](apps/admin-next/src/app/globals.css)

Tailwind CSS v4 是 **CSS-first 配置**，不再需要 `tailwind.config.js`（自定义主题直接在 CSS 里写）。

### 6a. 创建 PostCSS 配置

创建 `postcss.config.mjs`（参考 [`apps/admin-next/postcss.config.mjs`](apps/admin-next/postcss.config.mjs)）：

```mjs
/** @type {import('postcss').Config} */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {},
  },
};

export default config;
```

### 6b. 创建 CSS 入口文件

创建 `src/app/index.css`（参考 [`apps/admin-next/src/app/globals.css`](apps/admin-next/src/app/globals.css)）：

```css
@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

/* 自定义主题色（HyperPush 可以选自己的配色） */
:root {
  --background: 0 0% 100%;
  --foreground: 222.2 84% 4.9%;
  --card: 0 0% 100%;
  --card-foreground: 222.2 84% 4.9%;
  --popover: 0 0% 100%;
  --popover-foreground: 222.2 84% 4.9%;
  --primary: 221.2 83.2% 53.3%;
  --primary-foreground: 210 40% 98%;
  --secondary: 210 40% 96.1%;
  --secondary-foreground: 222.2 47.4% 11.2%;
  --muted: 210 40% 96.1%;
  --muted-foreground: 215.4 16.3% 46.9%;
  --accent: 210 40% 96.1%;
  --accent-foreground: 222.2 47.4% 11.2%;
  --destructive: 0 84.2% 60.2%;
  --destructive-foreground: 210 40% 98%;
  --border: 214.3 31.8% 91.4%;
  --input: 214.3 31.8% 91.4%;
  --ring: 221.2 83.2% 53.3%;
  --radius: 0.5rem;
}

.dark {
  --background: 222.2 84% 4.9%;
  --foreground: 210 40% 98%;
  --card: 222.2 84% 4.9%;
  --card-foreground: 210 40% 98%;
  --popover: 222.2 84% 4.9%;
  --popover-foreground: 210 40% 98%;
  --primary: 217.2 91.2% 59.8%;
  --primary-foreground: 222.2 47.4% 11.2%;
  --secondary: 217.2 32.6% 17.5%;
  --secondary-foreground: 210 40% 98%;
  --muted: 217.2 32.6% 17.5%;
  --muted-foreground: 215 20.2% 65.1%;
  --accent: 217.2 32.6% 17.5%;
  --accent-foreground: 210 40% 98%;
  --destructive: 0 62.8% 30.6%;
  --destructive-foreground: 210 40% 98%;
  --border: 217.2 32.6% 17.5%;
  --input: 217.2 32.6% 17.5%;
  --ring: 224.3 76.3% 48%;
}

@theme {
  --font-sans: 'Inter', sans-serif;
  --color-background: hsl(var(--background));
  --color-foreground: hsl(var(--foreground));
  --color-primary: hsl(var(--primary));
  --color-primary-foreground: hsl(var(--primary-foreground));
  --color-secondary: hsl(var(--secondary));
  --color-secondary-foreground: hsl(var(--secondary-foreground));
  --color-muted: hsl(var(--muted));
  --color-muted-foreground: hsl(var(--muted-foreground));
  --color-accent: hsl(var(--accent));
  --color-accent-foreground: hsl(var(--accent-foreground));
  --color-destructive: hsl(var(--destructive));
  --color-destructive-foreground: hsl(var(--destructive-foreground));
  --color-border: hsl(var(--border));
  --color-input: hsl(var(--input));
  --color-ring: hsl(var(--ring));
  --color-popover: hsl(var(--popover));
  --color-popover-foreground: hsl(var(--popover-foreground));
  --color-card: hsl(var(--card));
  --color-card-foreground: hsl(var(--card-foreground));
  --radius-radius: var(--radius);
}
```

> 配色可以在搭建完成后按 HyperPush 的品牌风格修改，先用 Shadcn/ui 默认蓝色主题。

### 6c. Vite 配置（不需要额外插件）

Tailwind v4 通过 PostCSS 处理，Vite 会自动检测 `postcss.config.mjs`，不需要在 `vite.config.ts` 加任何 Tailwind 插件。

```ts
// vite.config.ts — 不需要 @tailwindcss/vite 插件
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
```

---

## 第 7 步：项目目录结构

```
HyperPush/
├── src/
│   ├── main.ts                 # NestJS 入口
│   ├── app.module.ts           # 根模块
│   ├── graphql/
│   │   ├── graphql.module.ts   # GraphQL 模块
│   │   └── resolvers/          # Resolver 文件
│   ├── auth/
│   │   ├── auth.module.ts      # 认证模块
│   │   ├── auth.service.ts     # JWT 签发
│   │   └── auth.guard.ts       # JWT 守卫
│   ├── prisma/
│   │   └── prisma.service.ts   # Prisma 服务
│   ├── app/                    # 前端 SPA
│   │   ├── main.tsx            # React 入口
│   │   ├── index.css           # Tailwind CSS
│   │   ├── routes/             # TanStack Router 路由
│   │   ├── components/         # UI 组件
│   │   ├── store/              # Redux Toolkit store
│   │   └── i18n/               # i18next 配置
│   └── lib/                    # 工具函数
├── prisma/
│   └── schema.prisma           # Prisma Schema
├── vite.config.ts
├── biome.json
├── tsconfig.json
├── tsconfig.build.json
├── nest-cli.json
├── package.json
└── Dockerfile
```

---

## 第 8 步：启动开发环境

```bash
# 终端 1：NestJS BFF
yarn start:dev

# 终端 2：前端
npx vite
```

---

## 第 9 步：API 层 — GraphQL ✅

> ✅ **已决定使用 GraphQL（@nestjs/graphql + Apollo Client）**
> 第 3/4 步已安装好依赖，直接开始写业务代码。

| 选型 | 后端 | 前端 |
|------|------|------|
| **GraphQL** | @nestjs/graphql + Apollo Server | Apollo Client + TanStack Query |

---

## 参考资料

- [NestJS 文档](https://docs.nestjs.com/)
- [NestJS + GraphQL 指南](https://docs.nestjs.com/graphql/quick-start)
- [Prisma 文档](https://www.prisma.io/docs)
- [TanStack Router 文档](https://tanstack.com/router)
- [Redux Toolkit 文档](https://redux-toolkit.js.org/)
- [Shadcn/ui 文档](https://ui.shadcn.com/)
- [Biome 文档](https://biomejs.dev/)
- [Tailwind CSS v4 文档](https://tailwindcss.com/docs)
