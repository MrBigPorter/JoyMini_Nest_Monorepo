# Frontend-Blog 项目初始化指南

> 官方标准化初始化流程，按照此文档执行可以零问题启动项目
> 预计完成时间: 15 分钟

---

## 🎯 架构方案确认

### 最终采用方案: 混合架构

| 运行环境              | 渲染模式            | 说明                                  |
| --------------------- | ------------------- | ------------------------------------- |
| **Web 浏览器**        | SSR + ISR           | Next.js 服务端渲染，SEO最优，首屏最快 |
| **H5 移动端**         | SSG 静态导出        | 纯静态文件部署到CDN                   |
| **iOS / Android App** | 100% CSR 客户端渲染 | Capacitor 打包，完全客户端运行        |

> **一套代码，三种运行模式**，不需要维护多份代码
> 自动检测运行环境，自动切换适配模式

---

## ⚠️ 必须注意的配置项

这些配置必须在第一天就设置好，否则后面会出现各种奇怪的问题：

### 1. Monorepo 集成配置

**必须继承根目录配置，绝对不要自己单独配置**

```json
// tsconfig.json
{
  "extends": "@repo/typescript-config/nextjs.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

```javascript
// .eslintrc.cjs
module.exports = {
  extends: ["@repo/eslint-config/next.js"],
};
```

**绝对不要安装单独的 eslint / typescript / prettier 版本**，全部使用 monorepo 统一版本

---

### 2. 环境变量配置

直接复制 admin-next 的环境文件，不要自己写：

```bash
cp apps/admin-next/.env.development apps/frontend-blog/
cp apps/admin-next/.env.production apps/frontend-blog/
```

只需要修改 `.env.development` 中的端口：

```env
PORT=3001
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXT_PUBLIC_SITE_URL=http://localhost:3001
```

---

### 3. Next.js 配置特殊说明

```typescript
// next.config.ts
const nextConfig = {
  output: "standalone",
  trailingSlash: false,
  experimental: {
    serverComponentsExternalPackages: ["@tanstack/react-query"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Access-Control-Allow-Origin", value: "*" }],
      },
    ];
  },
};

export default nextConfig;
```

⚠️ **重要**: App打包时使用 `output: 'export'` 静态导出模式

---

### 4. 依赖版本锁定

**所有依赖版本必须与 admin-next 保持完全一致**，禁止使用不同版本：

```json
{
  "dependencies": {
    "next": "15.2.0",
    "react": "19.2.0",
    "react-dom": "19.2.0",
    "@tanstack/react-query": "5.90.11",
    "zustand": "4.5.2",
    "next-intl": "^3.0.0",
    "axios": "1.13.2",
    "date-fns": "3.6.0",
    "dompurify": "3.3.3",
    "framer-motion": "12.0.0",
    "lucide-react": "0.555.0",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "tailwindcss": "4.1.17",
    "typescript": "5.5.4"
  }
}
```

⚠️ **绝对不要升级任何依赖版本**，保持与整个 monorepo 版本对齐，避免兼容性问题

---

## 🚀 标准化初始化步骤

### 第一步: 创建 Next.js 项目

```bash
# 在 monorepo 根目录执行
cd apps
npx create-next-app@15.2.0 frontend-blog --typescript --tailwind --eslint --app --no-src-dir --no-import-alias
```

选项选择:

- TypeScript
- Tailwind CSS
- ESLint
- App Router
- ❌ 不要 src 目录
- ❌ 不要 import alias (我们后面手动配置)

---

### 第二步: 清理默认文件

删除所有默认生成的示例文件：

```bash
cd frontend-blog
rm -rf app/* page.tsx layout.tsx favicon.ico globals.css
rm -rf public/*
rm .eslintrc.json
rm tsconfig.json
rm postcss.config.mjs
rm tailwind.config.ts
```

---

### 第三步: 配置 monorepo 继承

复制配置文件：

```bash
# 复制 admin-next 配置作为基础
cp ../admin-next/tsconfig.json .
cp ../admin-next/.eslintrc.cjs .
cp ../admin-next/postcss.config.mjs .
cp ../admin-next/tailwind.config.ts .
cp ../admin-next/.env.development .
cp ../admin-next/.env.production .
```

修改 `package.json` 名称：

```json
{
  "name": "@lucky/frontend-blog",
  "private": true,
  "version": "0.0.0"
}
```

---

### 第四步: 安装依赖

```bash
yarn install
```

安装额外依赖：

```bash
yarn add @tanstack/react-query zustand next-intl axios date-fns dompurify framer-motion lucide-react zod
yarn add @types/dompurify -D
```

---

### 第五步: 项目基础结构

创建标准目录结构：

```bash
mkdir -p src/app src/components src/lib src/lib/api src/lib/hooks src/lib/store src/lib/utils src/lib/types src/styles src/constants src/messages
```

---

### 第六步: 移植核心复用代码

**直接复制这些文件，不需要任何修改**：

```bash
# HTTP 客户端 (生产级代码，节省3天开发时间)
cp ../admin-next/src/lib/http.ts src/lib/
cp ../admin-next/src/lib/api/types.ts src/lib/api/

# 工具函数
cp ../admin-next/src/utils/sanitizeHtml.ts src/lib/utils/
cp ../admin-next/src/lib/utils/dateFormat.ts src/lib/utils/

# 主题系统
cp ../admin-next/src/lib/store/useThemeStore.ts src/lib/store/
```

只需要修改 `src/lib/http.ts` 中的 baseURL 配置即可

---

### 第七步: 启动验证

```bash
yarn dev
```

访问 http://localhost:3001 应该正常打开
没有任何控制台错误
热重载正常工作

---

## 初始化完成检查清单

| 检查项            | 状态 | 说明                       |
| ----------------- | ---- | -------------------------- |
| Monorepo 配置继承 |      | tsconfig / eslint 正确继承 |
| 环境变量配置      |      | 端口3001，API地址正确      |
| 依赖版本一致      |      | 所有包版本与admin-next相同 |
| 项目结构标准      |      | 目录结构符合架构文档       |
| HTTP客户端移植    |      | http.ts 正确复制修改       |
| 开发服务器启动    |      | localhost:3001 正常访问    |
| 热重载正常        |      | 修改代码自动刷新           |
| 没有编译错误      |      | yarn check-types 通过      |
| ESLint 通过       |      | yarn lint 通过             |

---

## 🚫 绝对禁止的操作

1. ❌ 不要修改根目录的任何配置
2. ❌ 不要单独安装不同版本的依赖
3. ❌ 不要自己重写HTTP客户端
4. ❌ 不要使用任何新的第三方库没有经过评审
5. ❌ 不要修改Tailwind主题Token，必须复用admin-next
6. ❌ 不要使用next.js的任何实验性功能

---

## 📅 接下来的开发顺序

### 第一天

- [x] 项目初始化完成
- [ ] 主题系统配置
- [ ] API 客户端层实现
- [ ] 布局组件 (Header / Footer)

### 第二天

- [ ] 首页实现
- [ ] 文章列表页
- [ ] 文章卡片组件

### 第三天

- [ ] 文章详情页
- [ ] 文章渲染器
- [ ] 评论系统

---

**文档版本**: 1.0.0
**最后更新**: 2026-04-06
**执行标准**: 必须严格按照此文档执行，不允许任何 deviation
