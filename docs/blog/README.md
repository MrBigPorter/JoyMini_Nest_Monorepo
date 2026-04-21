# 博客系统文档目录

> 📚 博客系统完整文档索引，按类别分类整理

---

## 📖 架构设计 `architecture/`

| 文档                                                                                          | 说明                 | 状态 |
| --------------------------------------------------------------------------------------------- | -------------------- | ---- |
| [blog-system-architecture.md](architecture/blog-system-architecture.md)                       | 博客系统整体架构设计 |      |
| [BLOG_SYSTEM_BACKEND_ARCHITECTURE_CN.md](architecture/BLOG_SYSTEM_BACKEND_ARCHITECTURE_CN.md) | 后端架构详细说明     |      |
| [FRONTEND_BLOG_ARCHITECTURE.md](architecture/FRONTEND_BLOG_ARCHITECTURE.md)                   | 前端架构设计         |      |
| [FRONTEND_ARCHITECTURE_LAYERS.md](architecture/FRONTEND_ARCHITECTURE_LAYERS.md)               | 前端分层架构         |      |
| [HOOKS_ARCHITECTURE.md](architecture/HOOKS_ARCHITECTURE.md)                                   | React Hooks 架构规范 |      |

---

## 📋 开发计划 `plans/`

| 文档                                                                                     | 说明             | 状态          |
| ---------------------------------------------------------------------------------------- | ---------------- | ------------- |
| [FRONTEND_DEVELOPMENT_PLAN.md](plans/FRONTEND_DEVELOPMENT_PLAN.md)                       | 前端开发路线图   |               |
| [FRONTEND_BLOG_INITIALIZATION_GUIDE.md](plans/FRONTEND_BLOG_INITIALIZATION_GUIDE.md)     | 前端初始化指南   |               |
| [PRODUCTION_READINESS_CHECKLIST.md](plans/PRODUCTION_READINESS_CHECKLIST.md)             | 生产环境检查清单 |               |
| [NATIVE_FEATURES_ROADMAP.md](plans/NATIVE_FEATURES_ROADMAP.md)                           | 原生功能路线图   |               |
| [BLOG_SECURITY_REFORM_PLAN.md](plans/BLOG_SECURITY_REFORM_PLAN.md)                       | 安全改造计划     | ⚠️ 进行中 50% |
| [BLOG_ISSUES_FIX_PLAN.md](plans/BLOG_ISSUES_FIX_PLAN.md)                                 | 问题修复方案     | ⚠️ 进行中 30% |
| [BLOG_MODAL_I18N_FIX_IMPLEMENTATION.md](plans/BLOG_MODAL_I18N_FIX_IMPLEMENTATION.md)     | 模态框多语言修复 | ⚠️ 进行中 20% |
| [localized-form-fix-plan.md](plans/localized-form-fix-plan.md)                           | 本地化表单修复   | ⚠️ 进行中 40% |
| [translation-issue-detection-fix-plan.md](plans/translation-issue-detection-fix-plan.md) | 翻译问题检测     | ⚠️ 进行中 60% |
| [translation-progress-monitor-plan.md](plans/translation-progress-monitor-plan.md)       | 翻译进度监控     | ⚠️ 进行中 70% |

---

## 🔌 API 接口 `api/`

| 文档                                                                           | 说明                  | 状态 |
| ------------------------------------------------------------------------------ | --------------------- | ---- |
| [BLOG_API_SPECIFICATION.md](api/BLOG_API_SPECIFICATION.md)                     | API 接口详细规范 v1.0 |      |
| [API_INTEGRATION_PLAN.md](api/API_INTEGRATION_PLAN.md)                         | 前后端对接计划        |      |
| [AUTHENTICATION_INTEGRATION_GUIDE.md](api/AUTHENTICATION_INTEGRATION_GUIDE.md) | 认证集成指南          |      |

---

## 🎨 设计规范 `design/`

| 文档                                                                    | 说明             | 状态 |
| ----------------------------------------------------------------------- | ---------------- | ---- |
| [BLOG_DESIGN_GUIDELINES.md](design/BLOG_DESIGN_GUIDELINES.md)           | 博客设计准则     |      |
| [BLOG_PAGE_LAYOUTS.md](design/BLOG_PAGE_LAYOUTS.md)                     | 页面布局规范     |      |
| [BLOG_PROSE_STYLE_GUIDE.md](design/BLOG_PROSE_STYLE_GUIDE.md)           | 内容排版风格指南 |      |
| [BLOG_SEO_GUIDELINES.md](design/BLOG_SEO_GUIDELINES.md)                 | SEO 优化指南     |      |
| [MOBILE_COMPATIBILITY_GUIDE.md](design/MOBILE_COMPATIBILITY_GUIDE.md)   | 移动端兼容性指南 |      |
| [MULTI_MODE_RENDERING_DESIGN.md](design/MULTI_MODE_RENDERING_DESIGN.md) | 多模式渲染设计   |      |

---

## 📝 开发规范 `development/`

| 文档                                                                               | 说明                       | 状态 |
| ---------------------------------------------------------------------------------- | -------------------------- | ---- |
| [CODE_STYLE_RULES.md](development/CODE_STYLE_RULES.md)                             | 代码风格规范               |      |
| [ENOTEMPTY_BUILD_ERROR_SOLUTION.md](development/ENOTEMPTY_BUILD_ERROR_SOLUTION.md) | ENOTEMPTY 构建错误解决方案 |      |

## 🌐 国际化 `i18n/`

| 文档                                                                                              | 说明                            | 状态 |
| ------------------------------------------------------------------------------------------------- | ------------------------------- | ---- |
| [BLOG_I18N_ARCHITECTURE_AND_IMPLEMENTATION.md](i18n/BLOG_I18N_ARCHITECTURE_AND_IMPLEMENTATION.md) | 博客多语言架构与完整实施文档    |      |
| [I18N_NEXT_INTL_V3_FULL_GUIDE.md](i18n/I18N_NEXT_INTL_V3_FULL_GUIDE.md)                           | Next.js + next-intl v3 技术指南 |      |
| [I18N_TRANSLATIONS_GUIDE.md](i18n/I18N_TRANSLATIONS_GUIDE.md)                                     | 翻译文案规范                    |      |
| [IMAGE_TRANSLATION_IMPLEMENTATION.md](i18n/IMAGE_TRANSLATION_IMPLEMENTATION.md)                   | 图片翻译技术实现                |      |
| [MULTILINGUAL_API_DESIGN.md](i18n/MULTILINGUAL_API_DESIGN.md)                                     | 多语言API接口设计规范           |      |
| [HTTP_CLIENT_MULTILINGUAL_SUPPORT.md](i18n/HTTP_CLIENT_MULTILINGUAL_SUPPORT.md)                   | HTTP客户端多语言支持实现        |      |

---

## 📊 文档状态说明

| 标识 | 含义   |
| ---- | ------ |
|      | 已完成 |
| ⚠️   | 进行中 |
| 🚧   | 待编写 |
| ❌   | 已废弃 |

---

> **最后更新**: 2026-04-15
> **文档总数**: 24 个
> **完成进度**: 96%
> **最新进展**:
>
> - seed-blog.ts 已成功运行，博客种子数据就绪
> - 翻译系统工作正常，源语言配置修复完成
> - 多语言API后端实现完成 (LanguageService + BlogService集成)
> - HTTP客户端多语言支持集成完成 (next-intl + SSR兼容)
> - ENOTEMPTY 构建错误解决方案文档已添加
> - 🔄 前端博客UI开发100%完成，API集成进行中
>
> **多语言架构实现完成**:
>
> 1.  **后端LanguageService** - 完整的语言解析服务，支持优先级：查询参数 > Accept-Language头部 > 默认语言
> 2.  **BlogService集成** - 已注入LanguageService并更新了多语言字段处理
> 3.  **PublicBlogController更新** - 在API端点中集成了LanguageService
> 4.  **HTTP客户端集成** - 支持查询参数、next-intl集成、SSR环境语言检测
> 5.  **API文档更新** - 详细说明了多语言支持机制
> 6.  **设计文档完善** - 新增2个多语言相关文档
>
> **下一步计划**:
>
> 1. 前端博客API集成 (立即执行)
> 2. 翻译管理系统开发 (Week 3)
> 3. 多语言内容管理界面优化
>
> **结构调整**: 4个博客相关文档已从根目录plans/迁移到docs/blog/plans/
> **文档清理**: 2个冗余文档已删除（博客多语言功能改进建议.md、自动翻译功能验证报告.md）
> **新增文档**: 2个多语言实现文档 (MULTILINGUAL_API_DESIGN.md, HTTP_CLIENT_MULTILINGUAL_SUPPORT.md)
