# 📚 文档导航 — Lucky Nest Monorepo

> **32 个文档，6 大分类 + 1 个归档区。先看「必读」，再按需查。**  
> 最后更新：2026-03-24

---

## ⚡ 必读（新人 / 重新上手 请按顺序读这 3 个）

| #   | 文件                                                                                 | 一句话                                           |
| --- | ------------------------------------------------------------------------------------ | ------------------------------------------------ |
| 1   | [`getting-started/DEPLOY_QUICKSTART_CN.md`](getting-started/DEPLOY_QUICKSTART_CN.md) | 15 分钟从零把项目跑起来                          |
| 2   | [`getting-started/ONBOARDING_CN.md`](getting-started/ONBOARDING_CN.md)               | 项目全貌、技术栈、开发环境配置                   |
| 3   | [`../RUNBOOK.md`](../../RUNBOOK.md)                                                  | 发布 / 回滚 / 服务器操作完整手册（**唯一权威**） |

---

## 📁 目录结构

```
read/
├── getting-started/   ← 新人必读（3）
├── architecture/      ← 系统设计 + 备用（7）
├── devops/            ← 运维 + 事故 + 监控配置（4）
├── testing/           ← 测试规范与指南（3）
├── features/          ← 功能专题（8）
├── performance/       ← 性能监控 + SEO（5）
└── archive/           ← 历史文档，不再日常使用（3）
```

---

## 🚀 getting-started/ — 新人必读（3 个）

| 文件                                                                 | 内容                                           |
| -------------------------------------------------------------------- | ---------------------------------------------- |
| [`DEPLOY_QUICKSTART_CN.md`](getting-started/DEPLOY_QUICKSTART_CN.md) | ⭐ 本地启动 / 生产部署 15 分钟快启             |
| [`ONBOARDING_CN.md`](getting-started/ONBOARDING_CN.md)               | 项目全貌、技术栈、角色分工、开发环境配置       |
| [`SEED_GUIDE_CN.md`](getting-started/SEED_GUIDE_CN.md)               | ⭐ 数据初始化：seed 命令、重置密码、服务器操作 |

---

## 🏗️ architecture/ — 系统设计（6 个）

> 理解系统怎么搭的，备用。

| 文件                                                                                                                    | 内容                                                        |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| [`ADMIN_NEXT_SSR_CSR_REVIEW_CN.md`](architecture/ADMIN_NEXT_SSR_CSR_REVIEW_CN.md)                                       | ⭐ Admin Next SSR/CSR 架构评审 + 6-Stage 重构路线图（最新） |
| [`SERVER_FETCH_GUIDE_CN.md`](architecture/SERVER_FETCH_GUIDE_CN.md)                                                     | Server Component 数据获取模式速查                           |
| [`Chat Service.md`](architecture/Chat Service.md)                                                                       | 聊天服务整体设计（Flutter + NestJS + Socket.IO）            |
| [`ADMIN_NEXT_ARCHITECTURE_INTERVIEW_CN.md`](architecture/ADMIN_NEXT_ARCHITECTURE_INTERVIEW_CN.md)                       | 题：架构问答（含标准答案）                                  |
| [`ADMIN_NEXT_ARCHITECTURE_5MIN_ORAL_CN.md`](architecture/ADMIN_NEXT_ARCHITECTURE_5MIN_ORAL_CN.md)                       | 5 分钟口述架构要点                                          |
| [`ADMIN_NEXT_ARCHITECTURE_INTERVIEW_FLASHCARDS_CN.md`](architecture/ADMIN_NEXT_ARCHITECTURE_INTERVIEW_FLASHCARDS_CN.md) | 架构知识闪卡（背诵用）                                      |

---

## 🔧 devops/ — 运维 & 故障（4 个）

> 出故障先查 `RUNBOOK.md`，再查这里。

| 文件                                                                      | 内容                                                   |
| ------------------------------------------------------------------------- | ------------------------------------------------------ |
| [`LHCI_SENTRY_SETUP_CN.md`](devops/LHCI_SENTRY_SETUP_CN.md)               | ⭐ Lighthouse CI + Sentry 工作原理、接入配置、运维操作 |
| [`PRISMA_V6_MIGRATION_CN.md`](devops/PRISMA_V6_MIGRATION_CN.md)           | Prisma v6 升级踩坑 + 修复方案                          |
| [`TSCONFIG_MONOREPO_CN.md`](devops/TSCONFIG_MONOREPO_CN.md)               | Monorepo tsconfig 规范（违反会导致 dist 路径错乱）     |
| [`DEPLOY_INCIDENT_20260321_CN.md`](devops/DEPLOY_INCIDENT_20260321_CN.md) | 事故复盘：2026-03-21 容器启动失败 rootDir 问题         |

> **Sentry 配置文件**：`apps/admin-next/sentry.*.config.ts` + `src/instrumentation.ts`（含工作原理注释）  
> **Lighthouse 配置文件**：`apps/admin-next/lighthouserc.js`（CI 主入口；`lighthouserc.mjs` 仅兼容旧引用）

---

## 🧪 testing/ — 测试（3 个）

> 写测试前先看规范，不然 CI 红灯。

| 文件                                                         | 内容                                                |
| ------------------------------------------------------------ | --------------------------------------------------- |
| [`TESTING_STANDARDS_CN.md`](testing/TESTING_STANDARDS_CN.md) | ⭐ 测试规范：高频禁令、错误速查表、模板（**必读**） |
| [`TESTING_CN.md`](testing/TESTING_CN.md)                     | Vitest 单测完整指南                                 |
| [`TESTING_API_CN.md`](testing/TESTING_API_CN.md)             | 后端 API 接口测试指南                               |

---

## 🔩 features/ — 功能专题（8 个）

> 按功能模块查，了解设计决策和实现细节。

| 文件                                                                                      | 内容                                         |
| ----------------------------------------------------------------------------------------- | -------------------------------------------- |
| [`FEATURES_CN.md`](features/FEATURES_CN.md)                                               | 全部功能清单（23 项）                        |
| [`IM_SUPPORT_REALTIME_CN.md`](features/IM_SUPPORT_REALTIME_CN.md)                         | ⭐ 客服实时分发方案（Socket 推送架构）       |
| [`IM_SUPPORT_TECH_SHARE_CN.md`](features/IM_SUPPORT_TECH_SHARE_CN.md)                     | IM 技术分享（原理 + 代码解析）               |
| [`OAUTH_THIRDPARTY_LOGIN_CN.md`](features/OAUTH_THIRDPARTY_LOGIN_CN.md)                   | Google/Facebook/Apple OAuth 三方登录完整方案 |
| [`FLUTTER_OAUTH_INTEGRATION_GUIDE_CN.md`](features/FLUTTER_OAUTH_INTEGRATION_GUIDE_CN.md) | Flutter 端 OAuth 集成步骤                    |
| [`REGISTER_APPLICATION_CN.md`](features/REGISTER_APPLICATION_CN.md)                       | 注册申请功能（reCAPTCHA + 邮件通知 + 审批）  |
| [`LUCKY_DRAW_DESIGN_CN.md`](features/LUCKY_DRAW_DESIGN_CN.md)                             | 幸运抽奖系统设计                             |
| [`PRODUCT_ASSET_UPLOAD_LIST_CN.md`](features/PRODUCT_ASSET_UPLOAD_LIST_CN.md)             | 产品素材上传规范                             |

---

## 📊 performance/ — 性能 & 监控（5 个）

| 文件                                                                                                 | 内容                                                 |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| [`ADMIN_NEXT_SSR_UX_OPTIMIZATION_PLAN_CN.md`](performance/ADMIN_NEXT_SSR_UX_OPTIMIZATION_PLAN_CN.md) | ⭐ Admin Next SSR + 体验 + 性能分阶段优化执行计划    |
| [`PERFORMANCE_LIGHTHOUSE_CN.md`](performance/PERFORMANCE_LIGHTHOUSE_CN.md)                           | ⭐ Lighthouse 5 页面验收结果、指标记录表、优化决策树 |
| [`SEO_SUMMARY_CN.md`](performance/SEO_SUMMARY_CN.md)                                                 | SEO 优化总结（meta/OG/结构化数据）                   |
| [`SEO_PERFORMANCE_CN.md`](performance/SEO_PERFORMANCE_CN.md)                                         | Core Web Vitals 指标详解与优化手段                   |
| [`NEXT_SSR_SEO_CRAWLER_MASTER_GUIDE_CN.md`](performance/NEXT_SSR_SEO_CRAWLER_MASTER_GUIDE_CN.md)     | ⭐ Next SSR SEO + 爬虫抓取全链路实战总指南           |

---

## 🗄️ archive/ — 历史归档（3 个，不再日常使用）

| 文件                                                                           | 内容                        | 归档原因                 |
| ------------------------------------------------------------------------------ | --------------------------- | ------------------------ |
| [`SSR_UPGRADE_ANALYSIS_CN.md`](archive/SSR_UPGRADE_ANALYSIS_CN.md)             | SSR 升级决策分析（1458 行） | 已实施完成，历史决策记录 |
| [`PHASE5_E2E_AND_BUGFIX_CN.md`](archive/PHASE5_E2E_AND_BUGFIX_CN.md)           | Phase 5 E2E 测试工作日志    | 历史工作记录             |
| [`LOTTERY_AND_FLASHSALE_IMPL_CN.md`](archive/LOTTERY_AND_FLASHSALE_IMPL_CN.md) | 开奖/秒杀代码审计快照       | 已标记"历史归档"         |

---

## 🔍 快速定位（按问题查）

| 我遇到的问题                           | 去看哪里                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------- |
| 本地跑不起来                           | `getting-started/DEPLOY_QUICKSTART_CN.md`                                  |
| 生产部署 / 回滚                        | `RUNBOOK.md`（根目录）                                                     |
| 服务器 seed / 重置密码                 | `getting-started/SEED_GUIDE_CN.md`                                         |
| Sentry 没收到报错 / Lighthouse CI 红了 | `devops/LHCI_SENTRY_SETUP_CN.md`                                           |
| CI 单测红灯                            | `testing/TESTING_STANDARDS_CN.md`                                          |
| Docker 容器找不到 `dist/main.js`       | `devops/DEPLOY_INCIDENT_20260321_CN.md` + `devops/TSCONFIG_MONOREPO_CN.md` |
| Prisma 模型改了但 TS 报错              | `devops/PRISMA_V6_MIGRATION_CN.md`                                         |
| 想了解 IM 客服怎么实现的               | `features/IM_SUPPORT_REALTIME_CN.md`                                       |
| 想了解 SSR 是怎么做的                  | `architecture/ADMIN_NEXT_SSR_CSR_REVIEW_CN.md`                             |
| 需要技术分享 / / 材料                  | `architecture/ADMIN_NEXT_TECH_OVERVIEW_CN.md`                              |
| OAuth 登录对接                         | `features/OAUTH_THIRDPARTY_LOGIN_CN.md`                                    |
| Lighthouse 跑分结果                    | `performance/PERFORMANCE_LIGHTHOUSE_CN.md`                                 |

---

## 📋 文档维护约定

- **发布流程**：只在 `RUNBOOK.md` 维护，其他文档不重复
- **新人上手**：只在 `getting-started/` 维护
- **新增功能**：在 `features/` 对应文档更新，同时在 `features/FEATURES_CN.md` 加条目
- **事故复盘**：新建 `devops/DEPLOY_INCIDENT_YYYYMMDD_CN.md`，在本索引登记
- **历史文档**：不再活跃使用的移到 `archive/`，不要删除（保留决策上下文）
