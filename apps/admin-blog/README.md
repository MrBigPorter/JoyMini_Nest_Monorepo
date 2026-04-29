# @lucky/admin-blog — Blog CMS Admin Dashboard

[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](apps/admin-blog/package.json)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](apps/admin-blog/package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss)
[![Cloudflare](https://img.shields.io/badge/Cloudflare-Workers%20%2B%20Pages-F38020?logo=cloudflare)
[![Sentry](https://img.shields.io/badge/Sentry-10-362D59?logo=sentry)

> Blog content management dashboard built with Next.js 15 App Router. Part of the [Lucky Nest Monorepo](../README.md).

---

## ✨ Overview

`@lucky/admin-blog` is the administrative interface for managing blog content on the Lucky Nest platform. It provides editors and administrators with tools to create, edit, and manage articles, categories, tags, comments, and media assets for the public-facing blog at [blog.joyminis.com](https://blog.joyminis.com).

Built with **Next.js 15 App Router**, **Zustand** for client-state persistence, **TanStack Query** for server-state caching, and **React Quill** for rich text editing with Markdown support. Deployed on **Cloudflare Workers** via OpenNext.

---

## 🛠️ Tech Stack

| Category        | Technologies                                                       |
| --------------- | ------------------------------------------------------------------ |
| **Framework**   | Next.js 15 (App Router), React 19, TypeScript 5.5                  |
| **Styling**     | Tailwind CSS 4, Framer Motion, Lucide Icons                        |
| **State**       | Zustand (persisted), TanStack Query 5, TanStack Table 8            |
| **Forms**       | React Hook Form 7, Zod 3, @hookform/resolvers                      |
| **Editor**      | React Quill (rich text), Markdown (marked + react-markdown)        |
| **HTTP**        | Axios (custom HttpClient with retry, dedup, token refresh)         |
| **i18n**        | next-intl (6 languages: EN, ZH, JA, KO, FR, DE)                    |
| **DnD**         | @dnd-kit (drag-and-drop sortable lists)                            |
| **Infrastructure** | Cloudflare Workers + Pages, OpenNext, Sentry                    |
| **Deployment**  | `@opennextjs/cloudflare` → `wrangler deploy`                       |

---

## 🧠 Technical Challenges & Solutions

### 1. Rich Text Editing with Markdown

**Problem:** Blog content needs rich formatting (headings, images, code blocks, tables) while also supporting Markdown input for technical articles. The editor must handle both workflows seamlessly.

**Solution:** Dual-editor approach — [React Quill](https://github.com/zenoamaro/react-quill) for WYSIWYG editing with custom toolbar (headings, lists, code blocks, media embedding) and live Markdown preview via `react-markdown` + `remark-gfm`. Articles are stored as HTML and sanitized with DOMPurify before rendering.

### 2. Multi-Language Content Management

**Problem:** Blog articles must support 6 languages with translated titles, content, and metadata. Managing translations inline without a dedicated translation service requires a clean i18n architecture.

**Solution:** Each article stores translations as a JSON field (`translations: { zh: {...}, en: {...}, ... }`). The admin UI provides language tabs for switching between translations during editing. AI-powered translation (via Gemini API, handled server-side) can auto-translate content as a starting point.

### 3. Drag-and-Drop Category/Tag Ordering

**Problem:** Categories and tags need custom sort ordering for display on the public blog. Manual numeric priority fields are error-prone and unintuitive.

**Solution:** [@dnd-kit](https://dndkit.com/) sortable lists allow drag-and-drop reordering of categories and tags. Sort order is persisted to the backend API and respected by the public blog's query.

---

## 🚀 Getting Started

### Prerequisites

Same as monorepo root — see [Monorepo Root](../README.md#prerequisites).

### Development

```bash
# Start backend infrastructure (PostgreSQL + Redis)
docker compose --env-file deploy/.env.dev up -d

# Start admin-blog dev server (port 4002)
yarn workspace @lucky/admin-blog dev
```

### Build & Deploy

```bash
# Local build
yarn workspace @lucky/admin-blog build

# Deploy to Cloudflare Workers (production)
yarn workspace @lucky/admin-blog deploy:cloudflare:production

# Deploy to preview environment
yarn workspace @lucky/admin-blog deploy:cloudflare:preview
```

---

## 📦 Key Features

| Feature            | Description                                                    |
| ------------------ | -------------------------------------------------------------- |
| **Article Editor** | Rich text + Markdown editing with live preview                 |
| **Category Mgmt**  | Create/edit/delete categories with drag-and-drop sort          |
| **Tag Management** | Color-coded tags with custom ordering                          |
| **Comment Mod.**   | Approve, reject, reply to reader comments                      |
| **Media Manager**  | Upload and manage images (with SmartImage optimization)        |
| **Bulk Actions**   | Batch publish/unpublish/delete articles                        |
| **AI Translation** | Auto-translate article content via Gemini API                  |
| **SEO Metadata**   | Edit meta titles, descriptions, Open Graph images per article  |

---

## 🔗 Related

- [Monorepo Root](../README.md) — Project overview and architecture
- [@lucky/api](../api/README.md) — NestJS backend API (blog endpoints)
- [@lucky/frontend-blog](../frontend-blog/README.md) — Public blog frontend
- [@repo/ui](../packages/ui/README.md) — Shared UI component library
- [@lucky/shared](../packages/shared/README.MD) — Shared types and utilities

---

## 📄 License

Part of the Lucky Nest Monorepo. See the [root license](../README.md) for details.
