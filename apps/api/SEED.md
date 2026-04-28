# 分类

docker exec -it lucky-backend-dev sh -lc "\
cd /app && \
yarn workspace @lucky/api dlx tsx scripts/seed/product-category-list.ts"

# 商品

docker exec -it lucky-backend-dev sh -lc "\
cd /app && \
yarn workspace @lucky/api dlx tsx scripts/seed/seed-treasures.ts"

# 关联（商品-分类）

docker exec -it lucky-backend-dev sh -lc "\
cd /app && \
yarn workspace @lucky/api dlx tsx scripts/seed/link-treasure-categories.ts"

# 首页 banner

docker exec -it lucky-backend-dev sh -lc "\
cd /app && \
yarn workspace @lucky/api dlx tsx scripts/seed/seed-banners.ts"

# 首页广告

docker exec -it lucky-backend-dev sh -lc "\
cd /app && \
yarn workspace @lucky/api dlx tsx scripts/seed/seed-ads.ts"

# actSections

docker exec -it lucky-backend-dev sh -lc "\
cd /app && \
yarn workspace @lucky/api dlx tsx scripts/seed/seed-sections.ts"

# exchange rates

docker exec -it lucky-backend-dev \
sh -lc "cd apps/api && yarn dlx tsx scripts/seed/system-config-exchange-rate.ts"

# 钱包

docker exec -it lucky-backend-dev sh -lc "\
cd /app && \
yarn workspace @lucky/api dlx tsx scripts/seed/seed-wallet.ts"

# 博客种子数据

## Docker 容器内运行

docker exec -it lucky-backend-dev sh -lc "\
cd /app && \
yarn workspace @lucky/api dlx tsx scripts/seed/seed-blog.ts"

## 本地开发环境运行

cd apps/api && npx tsx scripts/seed/seed-blog.ts

## 导入内容统计

- **分类**: 6个（后端开发、前端开发、运维与部署、系统架构、安全防护、实战项目）
- **标签**: 27个（NestJS、Prisma、PostgreSQL、Redis、BullMQ、TypeScript、Next.js、React、Tailwind CSS等）
- **文章**: 6篇高质量技术文章
  - AC自动机算法实战：构建毫秒级敏感词过滤系统
  - ReCaptcha v3 无感人机验证完整实现方案
  - 零成本AI评论审核系统：Gemini 2.0 Flash 实战
  - NestJS 五层安全防护体系设计与实现
  - 异步任务队列在安全系统中的设计模式
  - XSS攻击与防御完整指南：现代Web应用安全实践

## 注意事项

1. 脚本会自动清空现有博客数据后重新导入
2. 需要数据库连接（自动加载 deploy/.env.dev 配置）
3. 文章作者默认为 admin 用户，如不存在则使用占位符
4. 所有内容为中文，可通过翻译系统生成多语言版本
