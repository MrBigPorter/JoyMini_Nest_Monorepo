'use client';

import { useEffect, useRef, isValidElement, Children } from 'react';
import { ArticleMeta } from '@/lib/types/frontend-blog';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import Hls from 'hls.js';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { HlsVideoPlayer } from './HlsVideoPlayer';
import { NativeVideoPlayer } from './NativeVideoPlayer';

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
  meta?: ArticleMeta;
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

  // Wrap <video> elements — Quill embeds <video> with optional nested <source>.
  // Must wrap the entire <video>...</video> block for proper responsive layout.
  // This also ensures videos appended by the backend video-preservation logic are styled correctly.
  result = result.replace(
    /(<video[^>]*>[\s\S]*?<\/video>)/gi,
    (match) => `<div class="article-media-wrapper">${match}</div>`,
  );

  // Wrap <svg> blocks (inline diagrams)
  result = result.replace(
    /(<svg[^>]*>[\s\S]*?<\/svg>)/gi,
    (match) => `<div class="article-media-wrapper">${match}</div>`,
  );

  return result;
}

export default function ArticleMarkdown({
  content,
  meta,
}: ArticleMarkdownProps) {
  const articleRef = useRef<HTMLElement>(null);

  // For HTML content path: implement click-to-play with poster overlay.
  // Videos are NOT loaded on mount — only when user clicks the play button.
  // HLS is initialized lazily on first click per video.
  // Multi-video coordination: only one video plays at a time.
  useEffect(() => {
    if (!isHtmlContent(content)) return;
    if (!articleRef.current) return;

    const container = articleRef.current;
    const hlsInstances: Hls[] = [];
    const overlayMap = new Map<HTMLVideoElement, HTMLDivElement>();

    container.querySelectorAll<HTMLVideoElement>('video').forEach((video) => {
      // Determine HLS URL
      let hlsUrl = video.getAttribute('src') || '';
      if (!hlsUrl.includes('.m3u8')) {
        const source = video.querySelector<HTMLSourceElement>(
          'source[src*=".m3u8"]',
        );
        hlsUrl = source?.getAttribute('src') || '';
      }

      // If still not m3u8, look up in meta.contentVideo by matching videoKey
      if (!hlsUrl.includes('.m3u8') && meta?.contentVideo) {
        const srcAttr = video.getAttribute('src') || '';
        const matched = meta.contentVideo.find((entry) =>
          srcAttr.includes(entry.videoKey),
        );

        if (matched?.hlsUrl) {
          hlsUrl = matched.hlsUrl;
          // Also set poster from contentVideo entry if available
          if (matched?.poster) {
            video.setAttribute('poster', matched.poster);
          }
        }
      }

      // Get poster (from attribute or closest image sibling)
      const poster = video.getAttribute('poster') || '';

      // Set preload=none so browser doesn't fetch the video on mount
      video.setAttribute('preload', 'none');
      // Give the video an intrinsic aspect-ratio so the container has height
      // even when preload="none" and no dimensions are known yet.
      video.style.aspectRatio = '16/9';
      video.style.width = '100%';
      video.dataset.hlsUrl = hlsUrl || video.getAttribute('src') || '';

      // Ensure the video's parent is position:relative for overlay
      const parent = video.parentElement;
      if (parent && getComputedStyle(parent).position === 'static') {
        parent.style.position = 'relative';
      }

      // ── Build overlay ──────────────────────────────────────────────────
      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position:absolute; inset:0; z-index:10;
        display:flex; align-items:center; justify-content:center;
        cursor:pointer; border-radius:0.5rem; overflow:hidden;
      `;

      // Poster background or dark gradient
      if (poster) {
        overlay.style.backgroundImage = `url(${poster})`;
        overlay.style.backgroundSize = 'cover';
        overlay.style.backgroundPosition = 'center';
      } else {
        overlay.style.background =
          'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)';
      }

      // Semi-transparent dark tint
      const tint = document.createElement('div');
      tint.style.cssText = `
        position:absolute; inset:0;
        background:${poster ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.15)'};
      `;

      // Play button circle
      const btn = document.createElement('div');
      btn.style.cssText = `
        position:relative; z-index:1;
        width:64px; height:64px; border-radius:50%;
        background:rgba(255,255,255,0.2);
        backdrop-filter:blur(6px);
        display:flex; align-items:center; justify-content:center;
        box-shadow:0 4px 20px rgba(0,0,0,0.4);
        transition:transform 0.2s, background 0.2s;
      `;
      btn.innerHTML = `<svg width="32" height="32" fill="white" viewBox="0 0 24 24" style="margin-left:4px"><path d="M8 5v14l11-7z"/></svg>`;
      btn.onmouseenter = () => {
        btn.style.transform = 'scale(1.1)';
        btn.style.background = 'rgba(255,255,255,0.35)';
      };
      btn.onmouseleave = () => {
        btn.style.transform = 'scale(1)';
        btn.style.background = 'rgba(255,255,255,0.2)';
      };

      overlay.appendChild(tint);
      overlay.appendChild(btn);

      // Insert overlay right after the video
      video.insertAdjacentElement('afterend', overlay);
      overlayMap.set(video, overlay);

      // ── Click handler ──────────────────────────────────────────────────
      let initialized = false;
      const initAndPlay = () => {
        if (initialized) return;
        initialized = true;

        // Remove overlay
        overlay.remove();
        overlayMap.delete(video);

        // Notify other videos to pause
        window.dispatchEvent(
          new CustomEvent('hls-video-play', {
            detail: { hlsUrl: video.dataset.hlsUrl },
          }),
        );

        const isHls = hlsUrl && hlsUrl.includes('.m3u8');

        if (isHls) {
          // Remove native src before attaching hls.js
          video.removeAttribute('src');

          if (Hls.isSupported()) {
            const hls = new Hls({
              enableWorker: true,
              lowLatencyMode: true,
              backBufferLength: 30,
            });
            hls.loadSource(hlsUrl);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              video.play().catch(() => {});
            });
            hlsInstances.push(hls);
          } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = hlsUrl;
            video.play().catch(() => {});
          }
        } else {
          // Regular mp4 — restore src and play natively
          const nativeSrc =
            video.dataset.hlsUrl ||
            video.querySelector('source')?.getAttribute('src') ||
            '';
          if (nativeSrc) video.src = nativeSrc;
          video.setAttribute('preload', 'metadata');
          video.play().catch(() => {});
        }
      };

      overlay.addEventListener('click', initAndPlay);

      // Play coordination: when this video plays, notify others
      video.addEventListener('play', () => {
        window.dispatchEvent(
          new CustomEvent('hls-video-play', {
            detail: { hlsUrl: video.dataset.hlsUrl },
          }),
        );
      });
    });

    // Listen for other videos playing — pause if not the active one
    const handleOtherVideoPlay = (e: Event) => {
      const activeHlsUrl = (e as CustomEvent).detail?.hlsUrl;
      if (!activeHlsUrl) return;
      container
        .querySelectorAll<HTMLVideoElement>('video[data-hls-url]')
        .forEach((v) => {
          if (v.dataset.hlsUrl !== activeHlsUrl && !v.paused) {
            v.pause();
          }
        });
    };

    window.addEventListener('hls-video-play', handleOtherVideoPlay);

    return () => {
      window.removeEventListener('hls-video-play', handleOtherVideoPlay);
      hlsInstances.forEach((h) => h.destroy());
      // Clean up overlays
      overlayMap.forEach((overlay) => overlay.remove());
      overlayMap.clear();
    };
  }, [content]);

  // For HTML content (Quill editor or pre-rendered markdown), render directly
  if (isHtmlContent(content)) {
    return (
      <article
        ref={articleRef}
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
          // Prevent wrapping block-level elements (video, div, etc.) in <p> tags
          // to avoid "In HTML, <div> cannot be a descendant of <p>" hydration errors.
          // React Markdown incorrectly wraps raw HTML (from rehypeRaw) in <p> tags.
          p({ children, node, ...props }) {
            // If this <p> is from rehypeRaw and contains block-level elements,
            // render as div instead to avoid invalid HTML nesting
            if (node?.children) {
              const hasBlockChild = node.children.some((child: any) => {
                if (child.type === 'element') {
                  const tagName = child.tagName?.toLowerCase() || '';
                  return [
                    'div',
                    'video',
                    'figure',
                    'table',
                    'pre',
                    'iframe',
                    'blockquote',
                    'ul',
                    'ol',
                  ].includes(tagName);
                }
                return false;
              });
              if (hasBlockChild) {
                return <div>{children}</div>;
              }
            }

            // Check if children contains any block-level elements
            const hasBlockElement = (child: any): boolean => {
              if (typeof child === 'string') {
                // Check if string contains raw HTML block elements
                return /<(div|video|figure|table|pre|iframe|blockquote|h[1-6]|ul|ol)[\s>]/i.test(
                  child,
                );
              }
              if (isValidElement(child)) {
                // Cast to any to work around React 19 types where
                // isValidElement narrows props to {} (unknown)
                const el = child as any;
                // Check if React element is a block-level component
                const type = el.type as any;
                if (typeof type === 'string') {
                  return [
                    'div',
                    'video',
                    'figure',
                    'table',
                    'pre',
                    'iframe',
                    'blockquote',
                    'ul',
                    'ol',
                  ].includes(type);
                }
                // Check if it's our HlsVideoPlayer or wrapped component
                if (type?.name === 'HlsVideoPlayer') return true;
                // Check className for our wrapper
                if (el.props?.className?.includes('article-media-wrapper'))
                  return true;
                // Check if child has a node prop (from rehypeRaw) with a block-level tagName
                if (el.props?.node?.tagName) {
                  const tagName = el.props.node.tagName.toLowerCase();
                  return [
                    'div',
                    'video',
                    'figure',
                    'table',
                    'pre',
                    'iframe',
                    'blockquote',
                    'ul',
                    'ol',
                  ].includes(tagName);
                }
              }
              if (Array.isArray(child)) {
                return child.some(hasBlockElement);
              }
              return false;
            };

            const childrenArray = Children.toArray(children);
            const containsBlock = childrenArray.some(hasBlockElement);

            // If contains block elements, return as fragment (no p wrapper)
            if (containsBlock) {
              return <>{children}</>;
            }

            // Otherwise render normal <p> tag
            return <p>{children}</p>;
          },
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
          // Render <video> elements with HLS support via HlsVideoPlayer
          video({ src, node, ...props }) {
            const srcStr = typeof src === 'string' ? src : '';
            // Look up in meta.contentVideo to find HLS URL + poster for mp4 video
            const matched = meta?.contentVideo?.find((entry) =>
              srcStr.includes(entry.videoKey),
            );
            const effectiveHlsUrl = matched?.hlsUrl || srcStr;
            // Extract poster from contentVideo entry, fallback to HTML attribute
            const posterStr =
              matched?.poster ||
              (typeof props.poster === 'string' ? props.poster : undefined);

            // Check if this is a raw HTML video from rehypeRaw (has node prop)
            // If so, don't wrap in div to avoid invalid nesting inside <p>
            const isRawHtml = !!node;

            if (effectiveHlsUrl.includes('.m3u8')) {
              const player = (
                <HlsVideoPlayer
                  hlsUrl={effectiveHlsUrl}
                  poster={posterStr}
                  autoPlay={false}
                  muted={false}
                  clickToPlay={true}
                  className="w-full rounded-lg aspect-video"
                />
              );
              return isRawHtml ? (
                player
              ) : (
                <div className="article-media-wrapper">{player}</div>
              );
            }

            // For regular mp4 / non-HLS: click-to-play with poster overlay
            const player = (
              <NativeVideoPlayer
                src={srcStr}
                poster={posterStr}
                className="w-full"
              />
            );
            return isRawHtml ? (
              player
            ) : (
              <div className="article-media-wrapper">{player}</div>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </article>
  );
}
