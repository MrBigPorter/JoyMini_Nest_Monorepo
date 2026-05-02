# 多语言翻译文档与文案规范

> 完整的多语言文案集合，可直接复制到项目中使用
> 支持中文 / English 双语，预留扩展接口
> 所有文案已经按照模块分类整理

---

## 🎯 翻译原则

本系统的翻译分为**两层**，不要混淆：

### 第一层：静态 UI 文案 (`src/messages/`)

**静态文案多语言**: 页面标题、按钮、导航、提示文字等 UI 字符串
→ 通过 `src/messages/{locale}.json` 文件管理，使用 i18n key 引用

### 第二层：动态内容（AI 自动翻译）

**文章内容、分类名称、标签名称** → 通过 **Gemini AI 翻译管线**自动翻译
- 翻译由后台队列任务驱动（[`blog-ai.processor.ts`](../../apps/api/src/blog/processors/blog-ai.processor.ts))
- 翻译结果存储在数据库的 `Localized` 字段中（`titleLocalized`, `contentLocalized` 等）
- 前端按当前 locale 自动读取对应翻译
- 详见 [`ARTICLE_AUTHORING_STANDARD.md`](../development/ARTICLE_AUTHORING_STANDARD.md) 的编写规范

---

## 📦 翻译文件结构

```
src/messages/
├── zh-CN.json    # 简体中文
└── en.json       # English
```

---

## 🌏 完整翻译文案

### 📄 zh-CN.json (简体中文)

```json
{
  "common": {
    "home": "首页",
    "articles": "文章",
    "categories": "分类",
    "tags": "标签",
    "search": "搜索",
    "about": "关于",
    "loadMore": "加载更多",
    "noResults": "没有找到相关内容",
    "back": "返回",
    "submit": "提交",
    "cancel": "取消",
    "save": "保存",
    "delete": "删除",
    "edit": "编辑",
    "viewAll": "查看全部",
    "loading": "加载中...",
    "error": "发生错误，请稍后重试",
    "retry": "重试"
  },

  "article": {
    "readTime": "阅读时间",
    "minute": "分钟",
    "views": "浏览",
    "comments": "评论",
    "likes": "点赞",
    "share": "分享",
    "bookmark": "收藏",
    "relatedArticles": "相关文章",
    "previousArticle": "上一篇",
    "nextArticle": "下一篇",
    "updatedAt": "更新于",
    "publishedAt": "发布于",
    "author": "作者",
    "tableOfContents": "目录",
    "featured": "精选文章",
    "latestArticles": "最新文章",
    "popularArticles": "热门文章"
  },

  "comment": {
    "title": "评论",
    "writeComment": "发表评论",
    "loginRequired": "请先登录后评论",
    "submit": "发表评论",
    "reply": "回复",
    "loadMore": "加载更多评论",
    "noComments": "暂无评论，来发表第一条评论吧",
    "commentSubmitted": "评论已提交，审核通过后显示",
    "placeholder": "写下你的想法..."
  },

  "search": {
    "placeholder": "搜索文章...",
    "result": "找到 {count} 篇文章",
    "noResults": "没有找到相关文章",
    "hotKeywords": "热门搜索"
  },

  "category": {
    "title": "文章分类",
    "allCategories": "全部分类",
    "articleCount": "{count} 篇文章"
  },

  "tag": {
    "title": "标签云",
    "allTags": "全部标签",
    "articleCount": "{count} 篇文章"
  },

  "auth": {
    "login": "登录",
    "register": "注册",
    "logout": "退出登录",
    "email": "邮箱",
    "password": "密码",
    "confirmPassword": "确认密码",
    "forgotPassword": "忘记密码",
    "loginWithGoogle": "使用 Google 登录",
    "loginWithFacebook": "使用 Facebook 登录",
    "or": "或",
    "noAccount": "还没有账号？",
    "haveAccount": "已有账号？",
    "loginSuccess": "登录成功",
    "registerSuccess": "注册成功",
    "logoutSuccess": "已退出登录",
    "invalidCredentials": "邮箱或密码错误"
  },

  "error": {
    "404": "页面不存在",
    "404Description": "您访问的页面可能已被删除或不存在",
    "500": "服务器错误",
    "500Description": "服务器发生了一些问题，请稍后重试",
    "goHome": "返回首页"
  },

  "footer": {
    "copyright": "© 2026 Lucky Nest. 保留所有权利",
    "privacyPolicy": "隐私政策",
    "termsOfService": "服务条款",
    "rssFeed": "RSS 订阅"
  }
}
```

---

### 🌍 en.json (English)

```json
{
  "common": {
    "home": "Home",
    "articles": "Articles",
    "categories": "Categories",
    "tags": "Tags",
    "search": "Search",
    "about": "About",
    "loadMore": "Load More",
    "noResults": "No results found",
    "back": "Back",
    "submit": "Submit",
    "cancel": "Cancel",
    "save": "Save",
    "delete": "Delete",
    "edit": "Edit",
    "viewAll": "View All",
    "loading": "Loading...",
    "error": "An error occurred, please try again later",
    "retry": "Retry"
  },

  "article": {
    "readTime": "Reading time",
    "minute": "min",
    "views": "views",
    "comments": "comments",
    "likes": "likes",
    "share": "Share",
    "bookmark": "Bookmark",
    "relatedArticles": "Related Articles",
    "previousArticle": "Previous Article",
    "nextArticle": "Next Article",
    "updatedAt": "Updated at",
    "publishedAt": "Published at",
    "author": "Author",
    "tableOfContents": "Table of Contents",
    "featured": "Featured",
    "latestArticles": "Latest Articles",
    "popularArticles": "Popular Articles"
  },

  "comment": {
    "title": "Comments",
    "writeComment": "Write a comment",
    "loginRequired": "Please login to comment",
    "submit": "Post Comment",
    "reply": "Reply",
    "loadMore": "Load more comments",
    "noComments": "No comments yet, be the first to comment",
    "commentSubmitted": "Comment submitted, will appear after approval",
    "placeholder": "Share your thoughts..."
  },

  "search": {
    "placeholder": "Search articles...",
    "result": "{count} articles found",
    "noResults": "No articles found",
    "hotKeywords": "Hot Searches"
  },

  "category": {
    "title": "Categories",
    "allCategories": "All Categories",
    "articleCount": "{count} articles"
  },

  "tag": {
    "title": "Tags",
    "allTags": "All Tags",
    "articleCount": "{count} articles"
  },

  "auth": {
    "login": "Login",
    "register": "Register",
    "logout": "Logout",
    "email": "Email",
    "password": "Password",
    "confirmPassword": "Confirm Password",
    "forgotPassword": "Forgot Password",
    "loginWithGoogle": "Continue with Google",
    "loginWithFacebook": "Continue with Facebook",
    "or": "or",
    "noAccount": "Don't have an account?",
    "haveAccount": "Already have an account?",
    "loginSuccess": "Login successful",
    "registerSuccess": "Registration successful",
    "logoutSuccess": "Logged out successfully",
    "invalidCredentials": "Invalid email or password"
  },

  "error": {
    "404": "Page Not Found",
    "404Description": "The page you are looking for might have been removed or doesn't exist",
    "500": "Server Error",
    "500Description": "Something went wrong on our end, please try again later",
    "goHome": "Go to Homepage"
  },

  "footer": {
    "copyright": "© 2026 Lucky Nest. All rights reserved",
    "privacyPolicy": "Privacy Policy",
    "termsOfService": "Terms of Service",
    "rssFeed": "RSS Feed"
  }
}
```

---

## 🚀 使用方式

### 服务端组件

```tsx
import { useTranslations } from "next-intl/server";

export default async function HomePage() {
  const t = await useTranslations("common");
  return <h1>{t("home")}</h1>;
}
```

### 客户端组件

```tsx
"use client";
import { useTranslations } from "next-intl";

export default function SearchBox() {
  const t = useTranslations("search");
  return <input placeholder={t("placeholder")} />;
}
```

---

## 📋 翻译规范

1. **保持简短**: 按钮文案尽量不超过4个汉字 / 2个英文单词
2. **一致性**: 相同的功能使用相同的文案
3. **友好性**: 错误提示要友好，不要使用技术术语
4. **可扩展**: 所有文案都放在翻译文件中，不要在组件中硬编码任何字符串
5. **命名规范**: 使用小驼峰命名，含义清晰

---

## 开发检查清单

- [ ] 所有静态字符串都使用翻译key
- [ ] 没有硬编码的中文/英文字符串
- [ ] 所有新添加的文案同时更新两种语言
- [ ] 文案长度不会导致UI溢出
- [ ] 复数形式处理正确

---

所有文案已经准备好，可以直接复制到项目中使用。
