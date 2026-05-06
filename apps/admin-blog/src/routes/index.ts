import React from 'react';
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
  Settings,
  Upload,
  ShieldCheck,
} from 'lucide-react';

export type RouteGroup = 'Dashboard' | 'Content' | 'Tools' | 'System';

export interface RouteConfig {
  path: string;
  name: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  group: RouteGroup;
  hidden?: boolean;
}

export const routes: RouteConfig[] = [
  // ── Dashboard ──
  { path: '/', name: 'dashboard', icon: LayoutDashboard, group: 'Dashboard' },

  // ── Content (Blog Management) ──
  {
    path: '/blog/articles',
    name: 'articles',
    icon: Newspaper,
    group: 'Content',
  },
  {
    path: '/blog/articles/create',
    name: 'create_article',
    icon: FileText,
    group: 'Content',
    hidden: true,
  },
  {
    path: '/blog/articles/edit/[id]',
    name: 'edit_article',
    icon: FileText,
    group: 'Content',
    hidden: true,
  },
  {
    path: '/blog/categories',
    name: 'categories',
    icon: FolderTree,
    group: 'Content',
  },
  {
    path: '/blog/tags',
    name: 'tags',
    icon: Tags,
    group: 'Content',
  },
  {
    path: '/blog/comments',
    name: 'comments',
    icon: MessageCircle,
    group: 'Content',
  },
  {
    path: '/blog/import',
    name: 'import_articles',
    icon: Upload,
    group: 'Content',
  },

  // ── Tools ──
  {
    path: '/blog/translation-progress',
    name: 'translation_progress',
    icon: Sparkles,
    group: 'Tools',
    hidden: false,
  },
  {
    path: '/blog/translation-issues',
    name: 'translation_issues',
    icon: Search,
    group: 'Tools',
    hidden: false,
  },
  /* {
    path: '/blog/translation-quality',
    name: 'translation_quality',
    icon: ShieldCheck,
    group: 'Tools',
    hidden: false,
  },*/
  {
    path: '/blog/translation-quality-stream',
    name: 'translation_quality_stream',
    icon: ShieldCheck,
    group: 'Tools',
    hidden: false,
  },

  // ── System ──
  {
    path: '/settings',
    name: 'settings',
    icon: Cog,
    group: 'System',
  },
  {
    path: '/settings/locales',
    name: 'localeSettings',
    icon: Settings,
    group: 'System',
    hidden: true,
  },
];
