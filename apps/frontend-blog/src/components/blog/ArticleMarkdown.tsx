'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import type { ReactNode } from 'react';

interface ArticleMarkdownProps {
  content: string;
}

export default function ArticleMarkdown({ content }: ArticleMarkdownProps) {
  return (
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
        {content}
      </ReactMarkdown>
    </article>
  );
}
