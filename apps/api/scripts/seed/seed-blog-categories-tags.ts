/**
 * Safe Blog Category & Tag Seed Script
 *
 * IDEMPOTENT — safe to run on production.
 * - Checks slug uniqueness before inserting (skips existing records)
 * - Does NOT delete any data (no deleteMany)
 * - Does NOT touch articles, comments, or any other data
 * - Chinese-only names — auto-translation handles multi-language later
 *
 * Categories derived from blog article categories + planned article roadmap.
 * Tags extracted from 52 existing articles + 64 planned articles across the monorepo.
 *
 * Usage:
 *   cd apps/api && npx ts-node scripts/seed/seed-blog-categories-tags.ts
 */

import { PrismaClient } from '@prisma/client';
import { loadEnvForHost } from '../utils/load-env-for-host';

// loadEnvForHost() is only called when this file is run standalone (see main() below).
// When imported by the main seed runner (index.ts), env is already configured.

const prisma = new PrismaClient();

// ==============================================
// 📂 Blog Categories (8 categories)
// ==============================================
const CATEGORIES = [
  {
    name: { zh: '后端开发' },
    slug: 'backend',
    description: {
      zh: 'NestJS, 数据库, API 设计, 支付, 消息队列',
    },
  },
  {
    name: { zh: '前端开发' },
    slug: 'frontend',
    description: {
      zh: 'Next.js, React, Tailwind CSS, 状态管理, 动画',
    },
  },
  {
    name: { zh: '运维与部署' },
    slug: 'devops',
    description: {
      zh: 'Docker, CI/CD, Cloudflare, Sentry, 可观测性',
    },
  },
  {
    name: { zh: '系统架构' },
    slug: 'architecture',
    description: {
      zh: 'Monorepo, 微服务, 高可用, 设计模式, 实时通信',
    },
  },
  {
    name: { zh: '安全防护' },
    slug: 'security',
    description: {
      zh: 'XSS, JWT, ReCaptcha, 敏感词过滤, AI 审核, KYC',
    },
  },
  {
    name: { zh: '性能优化' },
    slug: 'performance',
    description: {
      zh: '打包体积, SSR 渲染, CI/CD 缓存, 加载优化',
    },
  },
  {
    name: { zh: '移动开发' },
    slug: 'mobile',
    description: {
      zh: 'Flutter, Dart, 跨平台开发, 移动端架构',
    },
  },
  {
    name: { zh: '实战项目' },
    slug: 'projects',
    description: {
      zh: '项目介绍, 架构总览, 技术选型, 最佳实践',
    },
  },
];

// ==============================================
// 🏷️ Blog Tags (63 tags across 7 domains)
// ==============================================
const TAGS = [
  // ===================== Backend / API =====================
  { name: { zh: 'NestJS' }, slug: 'nestjs', color: '#e0234e' },
  { name: { zh: 'Prisma' }, slug: 'prisma', color: '#2D3748' },
  { name: { zh: 'PostgreSQL' }, slug: 'postgresql', color: '#336791' },
  { name: { zh: 'Redis' }, slug: 'redis', color: '#dc382d' },
  { name: { zh: 'BullMQ' }, slug: 'bullmq', color: '#7248d4' },
  { name: { zh: 'TypeScript' }, slug: 'typescript', color: '#3178c6' },
  { name: { zh: 'WebSocket' }, slug: 'websocket', color: '#22c55e' },
  { name: { zh: 'Authentication' }, slug: 'authentication', color: '#8b5cf6' },
  { name: { zh: 'Authorization / RBAC' }, slug: 'authorization', color: '#a855f7' },
  { name: { zh: 'API Design' }, slug: 'api-design', color: '#0ea5e9' },
  { name: { zh: 'Media Processing' }, slug: 'media-processing', color: '#ec4899' },
  { name: { zh: 'Upload' }, slug: 'upload', color: '#14b8a6' },
  { name: { zh: 'Queue' }, slug: 'queue', color: '#8b5cf6' },
  { name: { zh: 'Distributed Lock' }, slug: 'distributed-lock', color: '#f59e0b' },
  { name: { zh: 'Device Security' }, slug: 'device-security', color: '#ef4444' },
  { name: { zh: 'KYC' }, slug: 'kyc', color: '#6366f1' },
  { name: { zh: 'Payment' }, slug: 'payment', color: '#22c55e' },
  { name: { zh: 'E-commerce' }, slug: 'ecommerce', color: '#10b981' },
  { name: { zh: 'Chat / IM' }, slug: 'im', color: '#06b6d4' },
  { name: { zh: 'Message Queue' }, slug: 'message-queue', color: '#0ea5e9' },

  // ===================== Frontend =====================
  { name: { zh: 'Next.js' }, slug: 'nextjs', color: '#000000' },
  { name: { zh: 'React' }, slug: 'react', color: '#61dafb' },
  { name: { zh: 'Tailwind CSS' }, slug: 'tailwind', color: '#06b6d4' },
  { name: { zh: 'Shadcn UI' }, slug: 'shadcn-ui', color: '#000000' },
  { name: { zh: '服务端渲染' }, slug: 'ssr', color: '#10b981' },
  { name: { zh: 'i18n / 多语言' }, slug: 'i18n', color: '#06b6d4' },
  { name: { zh: 'SEO' }, slug: 'seo', color: '#10b981' },
  { name: { zh: 'PWA' }, slug: 'pwa', color: '#8b5cf6' },
  { name: { zh: 'Animation' }, slug: 'animation', color: '#f472b6' },
  { name: { zh: 'Video / HLS' }, slug: 'hls', color: '#22c55e' },
  { name: { zh: 'React Query' }, slug: 'react-query', color: '#ef4444' },
  { name: { zh: 'Zustand' }, slug: 'zustand', color: '#f59e0b' },
  { name: { zh: 'React Hook Form' }, slug: 'react-hook-form', color: '#ec4899' },
  { name: { zh: 'Zod' }, slug: 'zod', color: '#1e3a5f' },
  { name: { zh: 'OAuth' }, slug: 'oauth', color: '#4285f4' },
  { name: { zh: 'Rich Text Editor' }, slug: 'rich-text-editor', color: '#f59e0b' },
  { name: { zh: 'CMS' }, slug: 'cms', color: '#f59e0b' },
  { name: { zh: 'AI Translation' }, slug: 'ai-translation', color: '#14b8a6' },
  { name: { zh: 'SmartTable' }, slug: 'smart-table', color: '#6366f1' },
  { name: { zh: 'Middleware' }, slug: 'middleware', color: '#ef4444' },
  { name: { zh: 'DataSynchronizer' }, slug: 'data-sync', color: '#6366f1' },

  // ===================== DevOps =====================
  { name: { zh: 'Docker' }, slug: 'docker', color: '#2496ed' },
  { name: { zh: 'Cloudflare' }, slug: 'cloudflare', color: '#f38020' },
  { name: { zh: 'Monorepo' }, slug: 'monorepo', color: '#f59e0b' },
  { name: { zh: 'Turbo' }, slug: 'turbo', color: '#ef4444' },
  { name: { zh: 'CI/CD' }, slug: 'cicd', color: '#f97316' },
  { name: { zh: 'Sentry' }, slug: 'sentry', color: '#fb7185' },
  { name: { zh: 'Lighthouse' }, slug: 'lighthouse', color: '#f59e0b' },
  { name: { zh: 'Monitoring' }, slug: 'monitoring', color: '#0ea5e9' },
  { name: { zh: 'Prisma Migration' }, slug: 'prisma-migration', color: '#2D3748' },

  // ===================== Security =====================
  { name: { zh: 'XSS' }, slug: 'xss', color: '#dc2626' },
  { name: { zh: 'ReCaptcha' }, slug: 'recaptcha', color: '#4285f4' },
  { name: { zh: 'AhoCorasick' }, slug: 'aho-corasick', color: '#8b5cf6' },
  { name: { zh: 'AI Moderation' }, slug: 'ai-moderation', color: '#14b8a6' },
  { name: { zh: 'Content Security' }, slug: 'content-security', color: '#6366f1' },
  { name: { zh: 'Bot Detection' }, slug: 'bot-detection', color: '#dc2626' },
  { name: { zh: '敏感词过滤' }, slug: 'sensitive-word', color: '#8b5cf6' },
  { name: { zh: 'JWT' }, slug: 'jwt', color: '#000000' },

  // ===================== Mobile / Flutter =====================
  { name: { zh: 'Flutter' }, slug: 'flutter', color: '#02569B' },
  { name: { zh: 'Dart' }, slug: 'dart', color: '#0175C2' },
  { name: { zh: 'Riverpod' }, slug: 'riverpod', color: '#8b5cf6' },
  { name: { zh: 'GoRouter' }, slug: 'gorouter', color: '#22c55e' },
  { name: { zh: 'Dio' }, slug: 'dio', color: '#0ea5e9' },
  { name: { zh: 'Firebase' }, slug: 'firebase', color: '#FFCA28' },
  { name: { zh: 'WebRTC' }, slug: 'webrtc', color: '#22c55e' },
  { name: { zh: 'Deep Link' }, slug: 'deep-link', color: '#8b5cf6' },
  { name: { zh: '状态管理' }, slug: 'state-management', color: '#a855f7' },
  { name: { zh: 'Design Tokens' }, slug: 'design-tokens', color: '#f59e0b' },
  { name: { zh: 'Image Cache' }, slug: 'image-cache', color: '#14b8a6' },
  { name: { zh: 'S3 Upload' }, slug: 's3-upload', color: '#f97316' },
  { name: { zh: '设备指纹' }, slug: 'device-fingerprint', color: '#ef4444' },
  { name: { zh: 'KYC Guard' }, slug: 'kyc-guard', color: '#6366f1' },
  { name: { zh: '动画扩展' }, slug: 'motion-x', color: '#f472b6' },

  // ===================== Architecture & Best Practices =====================
  { name: { zh: 'Microservices' }, slug: 'microservices', color: '#22c55e' },
  { name: { zh: 'High Availability' }, slug: 'high-availability', color: '#f97316' },
  { name: { zh: 'LLM' }, slug: 'llm', color: '#6366f1' },
  { name: { zh: 'Prompt Engineering' }, slug: 'prompt-engineering', color: '#ec4899' },
  { name: { zh: 'Best Practices' }, slug: 'best-practices', color: '#22c55e' },
  { name: { zh: 'Performance' }, slug: 'performance', color: '#f59e0b' },
  { name: { zh: 'Error Handling' }, slug: 'error-handling', color: '#ef4444' },
  { name: { zh: 'Platform Adapter' }, slug: 'platform-adapter', color: '#06b6d4' },
  { name: { zh: '实时通信' }, slug: 'real-time', color: '#0ea5e9' },
  { name: { zh: '缓存策略' }, slug: 'cache', color: '#f59e0b' },
];

export async function seedBlogCategoriesTags() {
  console.log('\n  📂 Seeding blog categories & tags...');

  // ── Categories ────────────────────────────────────────────
  let catCreated = 0;
  let catSkipped = 0;

  for (const cat of CATEGORIES) {
    const existing = await prisma.blogCategory.findUnique({
      where: { slug: cat.slug },
    });

    if (existing) {
      catSkipped++;
      continue;
    }

    await prisma.blogCategory.create({ data: cat });
    catCreated++;
  }

  console.log(`    Categories: ${catCreated} created, ${catSkipped} skipped`);

  // ── Tags ──────────────────────────────────────────────────
  let tagCreated = 0;
  let tagSkipped = 0;

  for (const tag of TAGS) {
    const existing = await prisma.blogTag.findUnique({
      where: { slug: tag.slug },
    });

    if (existing) {
      tagSkipped++;
      continue;
    }

    await prisma.blogTag.create({ data: tag as any });
    tagCreated++;
  }

  console.log(`    Tags: ${tagCreated} created, ${tagSkipped} skipped`);
  console.log('  ✅ Blog categories & tags seeding complete\n');
}

// ── Standalone entry ─────────────────────────────────────────
async function main() {
  loadEnvForHost(); // only needed when run directly
  console.log('\n🌱  Blog categories & tags seed ─────────────────');
  console.log(`    ${new Date().toISOString()}\n`);

  try {
    await seedBlogCategoriesTags();
  } finally {
    await prisma.$disconnect();
  }

  console.log('✨  Done!\n');
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('❌ Seed failed:', e);
      process.exit(1);
    });
}
