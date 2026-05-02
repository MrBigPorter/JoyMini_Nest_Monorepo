'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

// Register languages on demand — only what blog articles typically use
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import scss from 'react-syntax-highlighter/dist/esm/languages/prism/scss';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go';
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust';
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java';
import docker from 'react-syntax-highlighter/dist/esm/languages/prism/docker';
import nginx from 'react-syntax-highlighter/dist/esm/languages/prism/nginx';
import graphql from 'react-syntax-highlighter/dist/esm/languages/prism/graphql';

SyntaxHighlighter.registerLanguage('typescript', typescript);
SyntaxHighlighter.registerLanguage('javascript', javascript);
SyntaxHighlighter.registerLanguage('tsx', tsx);
SyntaxHighlighter.registerLanguage('jsx', jsx);
SyntaxHighlighter.registerLanguage('bash', bash);
SyntaxHighlighter.registerLanguage('sh', bash);
SyntaxHighlighter.registerLanguage('shell', bash);
SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('css', css);
SyntaxHighlighter.registerLanguage('scss', scss);
SyntaxHighlighter.registerLanguage('yaml', yaml);
SyntaxHighlighter.registerLanguage('yml', yaml);
SyntaxHighlighter.registerLanguage('sql', sql);
SyntaxHighlighter.registerLanguage('markdown', markdown);
SyntaxHighlighter.registerLanguage('md', markdown);
SyntaxHighlighter.registerLanguage('python', python);
SyntaxHighlighter.registerLanguage('py', python);
SyntaxHighlighter.registerLanguage('go', go);
SyntaxHighlighter.registerLanguage('rust', rust);
SyntaxHighlighter.registerLanguage('rs', rust);
SyntaxHighlighter.registerLanguage('java', java);
SyntaxHighlighter.registerLanguage('docker', docker);
SyntaxHighlighter.registerLanguage('dockerfile', docker);
SyntaxHighlighter.registerLanguage('nginx', nginx);
SyntaxHighlighter.registerLanguage('graphql', graphql);
SyntaxHighlighter.registerLanguage('gql', graphql);

interface ArticleMarkdownProps {
  content: string;
}

/**
 * Detect if content is HTML (rendered HTML, not markdown with code examples).
 * Quill-produced content or server-rendered markdown starts with an HTML tag.
 * Markdown content with code examples containing angle brackets will NOT match.
 */
function isHtmlContent(content: string): boolean {
  return /^\s*<\w+[^>]*>/.test(content.trim());
}

/**
 * Wrap potentially wide HTML elements (images, tables, SVGs, figures, pre blocks)
 * in a scrollable container so they behave like code blocks — natural width
 * preserved, horizontal scrollbar on overflow, no page-level horizontal scroll.
 *
 * ORDER MATTERS: <pre> wrapping must come FIRST so that content inside <pre>
 * blocks (which may contain <img>, <svg>, etc. as code examples) is NOT
 * accidentally matched by subsequent regex replacements.
 */
function wrapWideContent(html: string): string {
  let result = html;

  // Wrap <pre> blocks FIRST — these contain ASCII architecture diagrams,
  // flowcharts, and code blocks with box-drawing characters that are wider
  // than the viewport. Must go first to protect inner content from later regexes.
  result = result.replace(
    /(<pre[^>]*>[\s\S]*?<\/pre>)/gi,
    (match) => `<div class="article-media-wrapper">${match}</div>`,
  );

  // Wrap <table> elements (commonly rendered from markdown tables or diagrams)
  result = result.replace(
    /(<table[\s>][\s\S]*?<\/table>)/gi,
    (match) => `<div class="article-media-wrapper">${match}</div>`,
  );

  // Wrap <figure> elements (often contain img + figcaption)
  result = result.replace(
    /(<figure[\s>][\s\S]*?<\/figure>)/gi,
    (match) => `<div class="article-media-wrapper">${match}</div>`,
  );

  // Wrap standalone <img> tags (not already inside a wrapper)
  result = result.replace(
    /<img\s[^>]*>/gi,
    (match) => `<div class="article-media-wrapper">${match}</div>`,
  );

  // Wrap <svg> blocks (inline diagrams)
  result = result.replace(
    /(<svg[^>]*>[\s\S]*?<\/svg>)/gi,
    (match) => `<div class="article-media-wrapper">${match}</div>`,
  );

  return result;
}

export default function ArticleMarkdown({ content }: ArticleMarkdownProps) {
  // For HTML content (Quill editor or pre-rendered markdown), render directly
  if (isHtmlContent(content)) {
    return (
      <article
        className="prose prose-slate dark:prose-invert max-w-none break-words
          prose-headings:font-bold prose-headings:text-gray-900 dark:prose-headings:text-white
          prose-p:text-gray-700 dark:prose-p:text-gray-300
          prose-a:text-primary hover:prose-a:text-primary-600 prose-a:no-underline hover:prose-a:underline
          prose-img:rounded-lg prose-img:mx-auto
          prose-code:bg-gray-100 dark:prose-code:bg-white/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded
          prose-pre:bg-gray-900 dark:prose-pre:bg-gray-800 prose-pre:text-gray-100 prose-pre:overflow-x-auto
          prose-hr:border-t prose-hr:border-gray-200 dark:prose-hr:border-gray-700 prose-hr:my-8
          prose-table:w-full prose-table:border-collapse prose-table:border prose-table:border-gray-300 dark:prose-table:border-gray-600
          prose-th:bg-gray-100 dark:prose-th:bg-gray-800 prose-th:border prose-th:border-gray-300 dark:prose-th:border-gray-600 prose-th:px-4 prose-th:py-2 prose-th:text-left
          prose-td:border prose-td:border-gray-300 dark:prose-td:border-gray-600 prose-td:px-4 prose-td:py-2 prose-td:align-top
          prose-blockquote:border-primary prose-blockquote:bg-primary/5 prose-blockquote:px-4 prose-blockquote:py-2 prose-blockquote:rounded-r-lg
          prose-strong:text-gray-900 dark:prose-strong:text-white
          prose-li:my-0 prose-li:border-0"
        dangerouslySetInnerHTML={{ __html: wrapWideContent(content) }}
      />
    );
  }

  // For Markdown content, use ReactMarkdown with full syntax highlighting
  return (
    <article
      className="prose prose-slate dark:prose-invert max-w-none break-words
        prose-headings:font-bold prose-headings:text-gray-900 dark:prose-headings:text-white
        prose-p:text-gray-700 dark:prose-p:text-gray-300
        prose-a:text-primary hover:prose-a:text-primary-600 prose-a:no-underline hover:prose-a:underline
        prose-img:rounded-lg prose-img:mx-auto
        prose-code:bg-gray-100 dark:prose-code:bg-white/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded
        prose-pre:bg-gray-900 dark:prose-pre:bg-gray-800 prose-pre:text-gray-100 prose-pre:overflow-x-auto
        prose-hr:border-t prose-hr:border-gray-200 dark:prose-hr:border-gray-700 prose-hr:my-8
        prose-table:w-full prose-table:border-collapse prose-table:border prose-table:border-gray-300 dark:prose-table:border-gray-600
        prose-th:bg-gray-100 dark:prose-th:bg-gray-800 prose-th:border prose-th:border-gray-300 dark:prose-th:border-gray-600 prose-th:px-4 prose-th:py-2 prose-th:text-left
        prose-td:border prose-td:border-gray-300 dark:prose-td:border-gray-600 prose-td:px-4 prose-td:py-2 prose-td:align-top
        prose-blockquote:border-primary prose-blockquote:bg-primary/5 prose-blockquote:px-4 prose-blockquote:py-2 prose-blockquote:rounded-r-lg
        prose-strong:text-gray-900 dark:prose-strong:text-white
        prose-li:my-0 prose-li:border-0"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          hr() {
            return <hr className="border-0 !border-none h-0 m-0 p-0 !hidden" />;
          },
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : '';

            // Only use SyntaxHighlighter for code blocks with a detected language
            if (language) {
              return (
                <SyntaxHighlighter
                  style={oneDark}
                  language={language}
                  PreTag="div"
                  customStyle={{
                    margin: '1em 0',
                    borderRadius: '0.5rem',
                    fontSize: '0.875rem',
                    lineHeight: '1.5',
                  }}
                >
                  {String(children).replace(/\n$/, '')}
                </SyntaxHighlighter>
              );
            }

            // Inline code or code block without language — keep default styling
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
          // Wrap <img> in scrollable container (like code blocks)
          img({ src, alt, ...props }) {
            return (
              <div className="article-media-wrapper">
                <img src={src} alt={alt} {...props} />
              </div>
            );
          },
          // Wrap <table> in scrollable container (tables with many columns)
          table({ children, ...props }) {
            return (
              <div className="article-media-wrapper">
                <table {...props}>{children}</table>
              </div>
            );
          },
          // Wrap <pre> in scrollable container — catches code blocks WITHOUT a
          // detected language (e.g. ASCII architecture diagrams, plain text code
          // blocks). Code blocks WITH a language are handled by the `code`
          // component above via SyntaxHighlighter (PreTag="div"), so they are
          // NOT wrapped in <pre> by ReactMarkdown — no double-wrapping risk.
          pre({ children, ...props }) {
            return (
              <div className="article-media-wrapper">
                <pre {...props}>{children}</pre>
              </div>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </article>
  );
}
