/**
 * Safe Blog Category & Tag Seed Script
 *
 * IDEMPOTENT — safe to run on production.
 * - Checks slug uniqueness before inserting (skips existing records)
 * - Does NOT delete any data (no deleteMany)
 * - Does NOT touch articles, comments, or any other data
 * - Chinese-only names — auto-translation handles multi-language later
 *
 * Categories derived from docs/blog/articles/ directory structure.
 * Tags extracted from article frontmatter across all 46 articles.
 *
 * Usage:
 *   cd apps/api && yarn seed:blog
 */

import { PrismaClient } from '@prisma/client';
import { loadEnvForHost } from '../utils/load-env-for-host';

loadEnvForHost();

const prisma = new PrismaClient();

// ==============================================
// 📂 Blog Categories (from docs/blog/articles/ structure)
// ==============================================
const CATEGORIES = [
  {
    name: { zh: '系统架构' },
    slug: 'architecture',
    description: { zh: 'NestJS, Prisma, three-tier tsconfig, IM, WebSocket 架构设计' },
  },
  {
    name: { zh: '后端开发' },
    slug: 'backend',
    description: { zh: '订单支付, 钱包系统, WebRTC, 财务审计, Gemini AI' },
  },
  {
    name: { zh: '运维与部署' },
    slug: 'devops',
    description: { zh: 'Docker, Cloudflare, GitLab CI, Lighthouse CI, Sentry' },
  },
  {
    name: { zh: '前端开发' },
    slug: 'frontend',
    description: { zh: 'Next.js, React, SSR, PWA, 登录系统, i18n, SEO' },
  },
  {
    name: { zh: '性能优化' },
    slug: 'performance',
    description: { zh: '缓存架构, 打包体积优化, SSR UX, CI 缓存策略' },
  },
  {
    name: { zh: '安全防护' },
    slug: 'security',
    description: { zh: 'JWT, reCAPTCHA, AI 审核, 设备指纹, 敏感词过滤' },
  },
];

// ==============================================
// 🏷️ Blog Tags (from article frontmatter)
// ==============================================
const TAGS = [
  // Backend
  { name: { zh: 'NestJS' }, slug: 'nestjs', color: '#e0234e' },
  { name: { zh: 'Prisma' }, slug: 'prisma', color: '#2D3748' },
  { name: { zh: 'PostgreSQL' }, slug: 'postgresql', color: '#336791' },
  { name: { zh: 'Redis' }, slug: 'redis', color: '#dc382d' },
  { name: { zh: 'BullMQ' }, slug: 'bullmq', color: '#7248d4' },
  { name: { zh: 'TypeScript' }, slug: 'typescript', color: '#3178c6' },

  // Frontend
  { name: { zh: 'Next.js' }, slug: 'nextjs', color: '#000000' },
  { name: { zh: 'React' }, slug: 'react', color: '#61dafb' },
  { name: { zh: 'Tailwind CSS' }, slug: 'tailwind', color: '#06b6d4' },
  { name: { zh: 'SSR' }, slug: 'ssr', color: '#10b981' },
  { name: { zh: 'PWA' }, slug: 'pwa', color: '#ec4899' },
  { name: { zh: 'SEO' }, slug: 'seo', color: '#4285f4' },
  { name: { zh: 'i18n' }, slug: 'i18n', color: '#14b8a6' },

  // DevOps
  { name: { zh: 'Docker' }, slug: 'docker', color: '#2496ed' },
  { name: { zh: 'Cloudflare' }, slug: 'cloudflare', color: '#f38020' },
  { name: { zh: 'CI/CD' }, slug: 'cicd', color: '#22c55e' },
  { name: { zh: 'Monorepo' }, slug: 'monorepo', color: '#f59e0b' },

  // Architecture
  { name: { zh: '架构设计' }, slug: 'architecture', color: '#10b981' },
  { name: { zh: 'WebSocket' }, slug: 'websocket', color: '#8b5cf6' },
  { name: { zh: 'IM' }, slug: 'im', color: '#0ea5e9' },
  { name: { zh: '实时通信' }, slug: 'real-time', color: '#f97316' },

  // Security
  { name: { zh: '安全' }, slug: 'security', color: '#ef4444' },
  { name: { zh: 'JWT' }, slug: 'jwt', color: '#dc2626' },
  { name: { zh: '认证授权' }, slug: 'authentication', color: '#6366f1' },
  { name: { zh: 'RBAC' }, slug: 'rbac', color: '#22c55e' },
  { name: { zh: 'AI' }, slug: 'ai', color: '#8b5cf6' },

  // Performance
  { name: { zh: '性能优化' }, slug: 'performance', color: '#f59e0b' },
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
