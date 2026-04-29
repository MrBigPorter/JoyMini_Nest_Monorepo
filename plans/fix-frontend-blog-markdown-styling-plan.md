# Fix: Frontend Blog Markdown Preview — Overflow & Styling Parity

## Problem 1: Text Overflow
Long text/code blocks horizontally overflow instead of wrapping.

## Problem 2: Visual Difference
The admin blog preview at [`page.tsx:287-297`](../apps/admin-blog/src/app/(dashboard)/blog/articles/[slug]/page.tsx:287) uses extensive Tailwind prose modifiers that make it look polished:

```
prose-headings:font-bold prose-headings:text-gray-900
prose-p:text-gray-700
prose-a:text-primary hover:prose-a:text-primary-600
prose-img:rounded-lg prose-img:mx-auto
prose-code:bg-gray-100 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded
prose-pre:bg-gray-900 prose-pre:text-gray-100
prose-blockquote:border-primary prose-blockquote:bg-primary/5 prose-blockquote:rounded-r-lg
prose-strong:text-gray-900
```

The frontend blog's [`ArticleMarkdown.tsx`](../apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx:13) only has:
```
prose prose-slate dark:prose-invert max-w-none
```

## Fix: `apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx`

Apply the same Tailwind prose modifier classes from the admin preview, plus add overflow wrapping:

```tsx
<article className="prose prose-slate dark:prose-invert max-w-none break-words
  prose-headings:font-bold prose-headings:text-gray-900 dark:prose-headings:text-white
  prose-p:text-gray-700 dark:prose-p:text-gray-300
  prose-a:text-primary hover:prose-a:text-primary-600
  prose-img:rounded-lg prose-img:mx-auto
  prose-code:bg-gray-100 dark:prose-code:bg-white/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded
  prose-pre:bg-gray-900 dark:prose-pre:bg-gray-800 prose-pre:text-gray-100 prose-pre:overflow-x-auto
  prose-blockquote:border-primary prose-blockquote:bg-primary/5 prose-blockquote:px-4 prose-blockquote:py-2 prose-blockquote:rounded-r-lg
  prose-strong:text-gray-900 dark:prose-strong:text-white">
```

Key additions:
- `break-words` on article — wraps long unbroken text
- `prose-pre:overflow-x-auto` — scrollable code blocks
- All prose modifier classes from admin preview
