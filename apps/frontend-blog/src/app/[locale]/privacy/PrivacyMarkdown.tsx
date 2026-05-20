'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface PrivacyMarkdownProps {
  content: string;
}

export function PrivacyMarkdown({ content }: PrivacyMarkdownProps) {
  return (
    <article className="prose prose-sm md:prose-base dark:prose-invert max-w-none prose-headings:font-semibold prose-a:text-primary-500 prose-code:bg-muted prose-code:px-1 prose-code:rounded prose-pre:bg-muted prose-pre:border prose-pre:border-border">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </article>
  );
}
