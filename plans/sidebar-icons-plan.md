# Sidebar Navigation Icon Replacement Plan

## Problem

Currently, the sidebar navigation has duplicate/overlapping icons:

- **Categories** and **Tags** both use the `Tag` icon → visually identical
- **Articles** uses `FileText` which is **also used as the logo icon** → visual confusion

The user wants **each visible sidebar navigation item** to have a unique, visually distinguishable icon.

## Current vs Proposed Icons

| Route          | Current Icon      | New Icon                 | lucide-react Import | Notes                                                           |
| -------------- | ----------------- | ------------------------ | ------------------- | --------------------------------------------------------------- |
| **Dashboard**  | `LayoutDashboard` | `LayoutDashboard` (keep) | `LayoutDashboard`   | Already unique, keep as-is                                      |
| **Articles**   | `FileText`        | `Newspaper`              | `Newspaper`         | More semantic for articles; no longer conflicts with logo       |
| **Categories** | `Tag`             | `FolderTree`             | `FolderTree`        | Tree/hierarchy icon fits categories; already used in admin-next |
| **Tags**       | `Tag`             | `Tags`                   | `Tags`              | Multi-tag icon, clearly distinct from FolderTree                |
| **Comments**   | `MessageSquare`   | `MessageCircle`          | `MessageCircle`     | Different speech bubble shape                                   |
| **Settings**   | `Settings`        | `Cog`                    | `Cog`               | Classic gear icon, very distinct                                |

## Files to Modify

### 1. `apps/admin-blog/src/routes/index.ts`

**Update imports** (lines 2-10):

- Replace `Tag` with `Tags` (plural)
- Remove `MessageSquare`
- Add `Newspaper`, `FolderTree`, `MessageCircle`, `Cog`
- Keep `FileText` (still used by hidden routes: `create_article`, `edit_article`)
- Keep `LayoutDashboard`, `Sparkles`, `Search`, `Settings` (unchanged)

**Before:**

```typescript
import {
  LayoutDashboard,
  FileText,
  Tag,
  MessageSquare,
  Sparkles,
  Search,
  Settings,
} from "lucide-react";
```

**After:**

```typescript
import {
  LayoutDashboard,
  FileText,
  Newspaper,
  FolderTree,
  Tags,
  MessageCircle,
  Sparkles,
  Search,
  Settings,
  Cog,
} from "lucide-react";
```

**Update route icon assignments** (lines 24-96):

- Line 30: `articles` → `icon: Newspaper,`
- Line 50: `categories` → `icon: FolderTree,`
- Line 56: `tags` → `icon: Tags,`
- Line 62: `comments` → `icon: MessageCircle,`
- Line 86: `settings` → `icon: Cog,`

### 2. `apps/admin-blog/src/components/layout/Sidebar.tsx`

**Update imports** (lines 7-19):

- Replace `Tag` with `Tags`
- Remove `MessageSquare`
- Add `Newspaper`, `FolderTree`, `MessageCircle`, `Cog`
- Keep `FileText` (used as fallback on line 150: `|| FileText`)
- Keep `LayoutDashboard`, `Sparkles`, `Search`, `Image`, `ChevronLeft`, `ChevronRight`, `LogOut`, `X`

**Before:**

```typescript
import {
  LayoutDashboard,
  FileText,
  Tag,
  MessageSquare,
  Sparkles,
  Search,
  ChevronLeft,
  ChevronRight,
  LogOut,
  X,
  Image,
} from "lucide-react";
```

**After:**

```typescript
import {
  LayoutDashboard,
  FileText,
  Newspaper,
  FolderTree,
  Tags,
  MessageCircle,
  Cog,
  Sparkles,
  Search,
  ChevronLeft,
  ChevronRight,
  LogOut,
  X,
  Image,
} from "lucide-react";
```

**Update SIDEBAR_ICONS map** (lines 27-35):

- Replace `Tag` with `Tags`
- Replace `MessageSquare` with `MessageCircle`
- Add `Newspaper`, `FolderTree`, `Cog`

**Before:**

```typescript
const SIDEBAR_ICONS: Record<string, ...> = {
  LayoutDashboard,
  FileText,
  Tag,
  MessageSquare,
  Sparkles,
  Search,
  Image,
};
```

**After:**

```typescript
const SIDEBAR_ICONS: Record<string, ...> = {
  LayoutDashboard,
  FileText,
  Newspaper,
  FolderTree,
  Tags,
  MessageCircle,
  Cog,
  Sparkles,
  Search,
  Image,
};
```

## What Does NOT Change

- The logo icon (line 116 in Sidebar.tsx) stays as `FileText` — it's the app logo, not a nav item
- Hidden routes (`create_article`, `edit_article`, `translation_progress`, `translation_issues`, `localeSettings`) keep their existing icons — they're not visible in the sidebar
- All other sidebar behavior (collapsed state, grouping, active state highlighting) remains unchanged

## Verification Steps

1. Run `yarn workspace @lucky/admin-blog type-check` to verify no TypeScript errors
2. Run `yarn workspace @lucky/admin-blog lint` to verify no lint errors
3. Restart dev server (already running on port 4002) — `.ts` file changes are HMR, but a restart ensures clean state
4. Visually verify each icon in the sidebar is distinct
