'use client';

import { useTranslations } from 'next-intl';
import { ChevronLeft, Clock, Calendar, User } from 'lucide-react';
import { Link } from '@/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import CommentList from '@/components/blog/CommentList';

// Mock 数据
const mockArticle = {
  title: '欢迎来到 Lucky Nest 博客平台',
  description:
    '这是 Lucky Nest 官方博客，我们将在这里分享产品更新、开发日志和行业见解。',
  content: `
# 欢迎来到 Lucky Nest 博客

欢迎访问 Lucky Nest 官方博客！我们很高兴能在这里和大家分享我们的故事。

## 关于这个博客

在这里你可以找到:
- ✅ 产品更新公告
- ✅ 技术开发日志
- ✅ 行业最佳实践
- ✅ 团队工作日常

## 我们的目标

我们致力于打造最好的用户体验，让每个人都能轻松使用我们的产品。

> 好的设计是不可见的。当用户不需要思考如何使用你的产品时，你就成功了。

### 技术栈

我们使用的技术:
1. Next.js 15
2. React 19
3. Tailwind CSS v4
4. NestJS
5. Prisma ORM

\`\`\`typescript
const welcome = () => {
  console.log('Welcome to Lucky Nest Blog!');
};
\`\`\`

---

感谢你的访问，我们会持续更新内容。
  `,
  author: 'Lucky Nest Team',
  publishedAt: '2026-04-07',
  readingTime: '5 分钟',
};

export default function ArticlePage() {
  const t = useTranslations();

  return (
    <div className="max-w-[720px] mx-auto px-4 py-8 md:py-12">
      {/* 返回按钮 */}
      <div className="mb-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>{t('common.backToHome')}</span>
        </Link>
      </div>

      {/* 文章头部 */}
      <header className="mb-10">
        <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-6">
          {mockArticle.title}
        </h1>

        <p className="text-lg text-muted-foreground mb-6">
          {mockArticle.description}
        </p>

        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4" />
            <span>{mockArticle.author}</span>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            <span>{mockArticle.publishedAt}</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4" />
            <span>{mockArticle.readingTime}</span>
          </div>
        </div>
      </header>

      {/* 文章内容 */}
      <article className="prose prose-slate dark:prose-invert max-w-none">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw]}
          components={{
            h1: ({ children }) => (
              <h1 className="text-4xl font-bold mt-8 mb-6">{children}</h1>
            ),
            h2: ({ children }) => (
              <h2 className="text-3xl font-semibold mt-8 mb-4">{children}</h2>
            ),
            h3: ({ children }) => (
              <h3 className="text-2xl font-semibold mt-6 mb-4">{children}</h3>
            ),
            p: ({ children }) => (
              <p className="mb-6 leading-7 text-justify">{children}</p>
            ),
          }}
        >
          {mockArticle.content}
        </ReactMarkdown>
      </article>

      {/* 评论系统 */}
      <CommentList />
    </div>
  );
}
