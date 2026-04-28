# Plan: Extract Blog Management into Standalone Project

## Problem

`admin-next` (11.3 MiB handler.mjs) exceeds Cloudflare Workers' 3 MiB free plan limit. The blog management feature (7 pages + components + dependencies) contributes significantly to the bundle size. Extracting it into a separate project will:

1. Reduce `admin-next` bundle size below 3 MiB
2. Allow blog admin to be deployed independently
3. Keep the same API backend and auth system

## Architecture

```mermaid
graph TB
    subgraph "Monorepo apps/"
        AN[admin-next<br/>Next.js + Cloudflare Worker]
        BA[blog-admin NEW<br/>Next.js + Cloudflare Worker]
        FB[frontend-blog<br/>Next.js + Cloudflare Worker]
        API[NestJS API<br/>Docker/Server]
    end

    subgraph "Shared packages/"
        SHP[@lucky/shared]
        UI[@repo/ui]
    end

    BA -->|same API| API
    BA -->|same auth JWT| API
    BA --> SHP
    BA --> UI
    AN --> SHP
    AN --> UI
    FB -->|public API| API
```

## Files to Extract from admin-next to blog-admin

### 1. Page Files (7 pages + 1 dashboard)

| Source Path                                                              | Description                     |
| ------------------------------------------------------------------------ | ------------------------------- |
| `apps/admin-next/src/app/(dashboard)/blog/page.tsx`                      | Blog dashboard (stats overview) |
| `apps/admin-next/src/app/(dashboard)/blog/articles/page.tsx`             | Article list                    |
| `apps/admin-next/src/app/(dashboard)/blog/articles/create/page.tsx`      | Create article                  |
| `apps/admin-next/src/app/(dashboard)/blog/categories/page.tsx`           | Category management             |
| `apps/admin-next/src/app/(dashboard)/blog/tags/page.tsx`                 | Tag management                  |
| `apps/admin-next/src/app/(dashboard)/blog/comments/page.tsx`             | Comment moderation              |
| `apps/admin-next/src/app/(dashboard)/blog/translation-progress/page.tsx` | Translation progress            |

### 2. View Components

| Source Path                                                             | Description                |
| ----------------------------------------------------------------------- | -------------------------- |
| `apps/admin-next/src/views/blog/ArticleForm.tsx`                        | Article form component     |
| `apps/admin-next/src/views/blog/BlogArticleModal.tsx`                   | Article detail modal       |
| `apps/admin-next/src/views/blog/BlogCategoryModal.tsx`                  | Category CRUD modal        |
| `apps/admin-next/src/views/blog/BlogCommentModal.tsx`                   | Comment moderation modal   |
| `apps/admin-next/src/views/blog/BlogTagModal.tsx`                       | Tag CRUD modal             |
| `apps/admin-next/src/views/blog/BlogTranslationProgress.tsx`            | Translation progress view  |
| `apps/admin-next/src/views/blog/components/TranslationProgressCard.tsx` | Translation card component |

### 3. Blog-specific Components

| Source Path                                                      | Description                          |
| ---------------------------------------------------------------- | ------------------------------------ |
| `apps/admin-next/src/components/blog/Html5VideoBlot.ts`          | Video blot for Quill                 |
| `apps/admin-next/src/components/blog/LanguageSwitch.tsx`         | Language switcher for blog forms     |
| `apps/admin-next/src/components/blog/LocalizedFieldEditor.tsx`   | Localized field editor               |
| `apps/admin-next/src/components/blog/LocalizedStatusButtons.tsx` | Status buttons for localized content |
| `apps/admin-next/src/components/blog/LocalizedText.tsx`          | Localized text display               |
| `apps/admin-next/src/components/blog/MarkdownImportModal.tsx`    | Markdown import modal                |
| `apps/admin-next/src/components/blog/RichTextEditor.css`         | Rich text editor styles              |
| `apps/admin-next/src/components/blog/RichTextEditor.tsx`         | Rich text editor (Quill-based)       |

### 4. Blog-specific Hooks

| Source Path                                         | Description              |
| --------------------------------------------------- | ------------------------ |
| `apps/admin-next/src/hooks/useBlogForm.ts`          | Blog form hook           |
| `apps/admin-next/src/hooks/useBlogFormSubmit.ts`    | Blog form submit hook    |
| `apps/admin-next/src/hooks/useBlogLocalizedForm.ts` | Blog localized form hook |

### 5. Blog Schema

| Source Path                          | Description                   |
| ------------------------------------ | ----------------------------- |
| `apps/admin-next/src/schema/blog.ts` | Zod schemas for blog entities |

### 6. Blog API Calls (in api/index.ts)

| Lines                              | Description                                                              |
| ---------------------------------- | ------------------------------------------------------------------------ |
| `blogApi` object (lines 1160-1519) | All blog API methods (articles, categories, tags, comments, translation) |

### 7. Blog i18n Translations

| Source Path                       | Description                   |
| --------------------------------- | ----------------------------- |
| `apps/admin-next/src/i18n/*.json` | Blog-related translation keys |

### 8. Blog Tests

| Source Path                                  | Description             |
| -------------------------------------------- | ----------------------- |
| `apps/admin-next/src/__tests__/views/*Blog*` | Blog-related test files |

## Dependencies to Move

From `apps/admin-next/package.json`, blog-specific dependencies:

| Dependency        | Reason                             |
| ----------------- | ---------------------------------- |
| `dompurify`       | HTML sanitization for blog content |
| `marked`          | Markdown parsing                   |
| `react-markdown`  | Markdown rendering                 |
| `react-quill-new` | Rich text editor                   |
| `remark-gfm`      | GitHub Flavored Markdown           |

These can be removed from `admin-next` after extraction.

## New Project Structure

```
apps/blog-admin/
├── package.json
├── next.config.ts
├── tsconfig.json
├── wrangler.jsonc
├── open-next.config.ts
├── postcss.config.mjs
├── tailwind.config.ts
├── .env.production
├── .env.development
├── src/
│   ├── app/
│   │   ├── layout.tsx          # Auth layout (reuse admin auth)
│   │   ├── globals.css
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx      # Sidebar + header layout
│   │   │   ├── page.tsx        # Blog dashboard (redirect or overview)
│   │   │   ├── articles/
│   │   │   │   ├── page.tsx
│   │   │   │   └── create/page.tsx
│   │   │   ├── categories/page.tsx
│   │   │   ├── tags/page.tsx
│   │   │   ├── comments/page.tsx
│   │   │   └── translation-progress/page.tsx
│   │   └── login/page.tsx      # Reuse admin login
│   ├── components/
│   │   └── blog/               # Copied from admin-next
│   ├── views/
│   │   └── blog/               # Copied from admin-next
│   ├── hooks/                  # Blog hooks
│   ├── schema/
│   │   └── blog.ts
│   ├── api/
│   │   ├── http.ts             # Reuse axios instance
│   │   └── index.ts            # blogApi only
│   ├── routes/
│   │   └── index.ts            # Blog routes only
│   ├── i18n/                   # Blog translations
│   ├── instrumentation.ts      # Sentry setup
│   └── middleware.ts           # Auth middleware
```

## Execution Steps

### Step 1: Create blog-admin project scaffold

- Create `apps/blog-admin/` directory
- Copy `package.json` from `frontend-blog` as template, rename to `@lucky/blog-admin`
- Add blog-specific deps: `dompurify`, `marked`, `react-markdown`, `react-quill-new`, `remark-gfm`
- Copy config files: `next.config.ts`, `tsconfig.json`, `postcss.config.mjs`, `tailwind.config.ts`
- Create `wrangler.jsonc` for Cloudflare Workers deployment
- Create `open-next.config.ts`

### Step 2: Copy blog page files

- Copy all 7 blog pages from `admin-next/src/app/(dashboard)/blog/` to `blog-admin/src/app/(dashboard)/`
- Copy blog view components from `admin-next/src/views/blog/` to `blog-admin/src/views/blog/`
- Copy blog components from `admin-next/src/components/blog/` to `blog-admin/src/components/blog/`

### Step 3: Copy blog hooks, schema, API

- Copy blog hooks from `admin-next/src/hooks/` (useBlogForm, useBlogFormSubmit, useBlogLocalizedForm)
- Copy `admin-next/src/schema/blog.ts`
- Copy blog API methods from `admin-next/src/api/index.ts` (blogApi section)
- Create `admin-next/src/api/http.ts` (axios instance)

### Step 4: Set up auth, layout, routing

- Create auth layout (reuse admin-next's auth pattern with JWT check)
- Create sidebar with blog-only routes
- Set up i18n for blog translations
- Set up Sentry instrumentation

### Step 5: Remove blog from admin-next

- Delete `apps/admin-next/src/app/(dashboard)/blog/` directory
- Delete `apps/admin-next/src/views/blog/` directory
- Delete `apps/admin-next/src/components/blog/` directory
- Delete blog hooks: `useBlogForm.ts`, `useBlogFormSubmit.ts`, `useBlogLocalizedForm.ts`
- Delete `apps/admin-next/src/schema/blog.ts`
- Remove `blogApi` from `apps/admin-next/src/api/index.ts`
- Remove blog routes from `apps/admin-next/src/routes/index.ts`
- Remove blog-specific deps from `package.json`: `dompurify`, `marked`, `react-markdown`, `react-quill-new`, `remark-gfm`
- Run `yarn install` to update lockfile

### Step 6: Build and verify

- Build `admin-next`: `yarn workspace @lucky/admin-next build && yarn workspace @lucky/admin-next build:cloudflare`
- Verify handler.mjs size < 3 MiB
- Build `blog-admin`: `yarn workspace @lucky/blog-admin build && yarn workspace @lucky/blog-admin build:cloudflare`
- Verify blog-admin builds successfully

### Step 7: Update deployment config

- Add blog-admin deploy script to `deploy/`
- Update CI/CD pipeline if needed

## Verification

1. `admin-next` handler.mjs should be < 3 MiB
2. `blog-admin` handler.mjs should be < 3 MiB (blog-only is much smaller)
3. All blog management features work in the new project
4. Auth (JWT) works the same way
5. API endpoints remain unchanged

## Rollback

If issues arise:

1. Revert blog page deletions in admin-next
2. Delete `apps/blog-admin/` directory
3. Restore `package.json` dependencies
4. Run `yarn install`
