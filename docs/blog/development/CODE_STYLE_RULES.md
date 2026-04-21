# 代码风格与命名规范

> 所有代码、注释、变量名、文件名 **必须使用英文**
> 零中文代码规范，强制执行
> 违反直接打回

---

## 🚫 绝对禁止事项

1. ❌ **禁止在代码中出现任何中文字符**
   - 变量名 ❌
   - 函数名 ❌
   - 文件名 ❌
   - 目录名 ❌
   - 代码注释 ❌
   - Git commit message ❌

2. ❌ **禁止在代码中硬编码任何字符串**
   - 所有用户可见文案必须使用 i18n 翻译key
   - 没有例外

---

## 命名规范

| 类型      | 规范             | 正确示例          | 错误示例                             |
| --------- | ---------------- | ----------------- | ------------------------------------ |
| 目录名    | 小写 + 短横线    | `article-card`    | `ArticleCard` `article_card`         |
| 文件名    | PascalCase 组件  | `ArticleCard.tsx` | `articleCard.tsx` `article-card.tsx` |
| 文件名    | camelCase 非组件 | `useArticles.ts`  | `UseArticles.ts` `use-articles.ts`   |
| 变量名    | camelCase        | `articleList`     | `ArticleList` `article_list`         |
| 常量名    | UPPER_SNAKE_CASE | `MAX_PAGE_SIZE`   | `maxPageSize`                        |
| 类型/接口 | PascalCase       | `Article`         | `article` `IArticle`                 |
| 函数名    | camelCase        | `fetchArticle`    | `FetchArticle`                       |
| 组件名    | PascalCase       | `ArticleCard`     | `articleCard`                        |
| CSS类名   | 小写 + 短横线    | `article-header`  | `articleHeader`                      |

---

## 代码注释规范

所有注释必须使用英文
注释要说明为什么，而不是做了什么
公共API必须有JSDoc注释

**正确示例:**

```typescript
/**
 * Fetches article by slug with caching strategy
 * @param slug Unique article identifier
 * @returns Article detail with rendered content
 */
async function fetchArticle(slug: string): Promise<Article> {
  // Cache for 15 minutes for published articles
  return http.get(`/articles/${slug}`, { next: { revalidate: 900 } });
}
```

**错误示例:**

```typescript
// 获取文章
async function 取文章(slug: string) {
  // 调用接口
  return 请求("/文章/" + slug);
}
```

---

## Git Commit 规范

所有Commit Message必须使用英文
遵循 Conventional Commits 规范

```
feat: add article like button
fix: resolve comment form validation error
docs: update api specification
refactor: rewrite article list component
style: format button styles
test: add unit tests for auth store
chore: update dependencies
```

---

## 代码审查检查清单

每个PR必须检查:

- [ ] 代码中没有任何中文字符
- [ ] 所有用户可见字符串使用i18n翻译key
- [ ] 所有命名符合规范
- [ ] 注释使用英文
- [ ] Commit Message使用英文
- [ ] 文件名/目录名符合规范
- [ ] 没有硬编码的字符串

---

## 🎯 例外情况

唯一允许出现中文的地方：
`src/messages/zh-CN.json` 翻译文件
Markdown 文档
测试数据

除此之外，任何地方不允许出现中文字符。

---

### 为什么这么严格？

1.  国际化友好 - 代码库是全球可理解的
2.  技术生态 - 所有开发工具、库、文档都是英文的
3.  一致性 - 不会出现半中半英的混乱代码
4.  可维护性 - 任何开发者都可以理解代码
5.  专业性 - 专业的代码库都是英文的

这不是偏好，这是行业标准。
