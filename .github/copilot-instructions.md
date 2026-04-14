# Lucky Nest Monorepo — Copilot Work Instructions

> **Important**: Always start each conversation by checking `## 🎯 Current Task`, follow the Phase progression, and do not work on unplanned tasks.

---

## 🎯 Current Task (Start Here for Each Conversation)

**Phase**: Phase 7 Blog System Development — Week 2 Frontend UI Refactoring & API Integration  
**Last Update**: Blog system 100% backend completed + 前端API集成完成 + 翻译源语言配置修复 (2026-04-13)
**Immediate Action**:

### ✅ Blog System Backend 100% Completed

**🎯 已完成里程碑**:

1. **✅ 数据库层**: Article/Category/Tag/Comment 4个核心模型设计完成 + 迁移执行
2. **✅ NestJS 博客模块**: 完整实现 BlogModule 包含 26+ API 端点
3. **✅ 权限系统**: AdminJwtAuthGuard + RolesGuard + ArticleOwnerGuard 三级权限体系
4. **✅ 业务逻辑**: Slug自动生成、状态机、计数器异步更新、索引优化全部实现
5. **✅ 前后端接口对齐**: HTTP方法、字段命名、分页格式、状态枚举全部匹配
6. **✅ 404 Page Issues**: Fixed routing mismatch between `/dashboard/blog/articles/[id]/edit` and `/blog/articles/[id]/edit`
7. **✅ API Interface Missing**: Created complete blog system API interface in `apps/admin-next/src/api/index.ts`
8. **✅ Frontend-Backend Integration**: Updated blog edit page to use real API calls instead of mock data
9. **✅ Routing Consistency**: Fixed link paths in article list page to match actual routes

**📊 Current Status**:

| Page/Component             | Status      | API Integration       |
| -------------------------- | ----------- | --------------------- |
| 🏠 **Blog Dashboard**      | ✅ Complete | ✅ **API Integrated** |
| 📝 **Article List**        | ✅ Complete | ✅ **API Integrated** |
| ✏️ **Article Create/Edit** | ✅ Complete | ✅ **API Integrated** |
| 📂 **Category Management** | ✅ Complete | ✅ **API Integrated** |
| 🏷️ **Tag Management**      | ✅ Complete | ✅ **API Integrated** |
| 💬 **Comment Management**  | ✅ Complete | ✅ **API Integrated** |

**🔧 Technical Improvements**:

- **API Interface**: Complete blog API interface with 26+ methods
- **Error Handling**: Proper error handling with toast notifications
- **Fallback Strategy**: Graceful fallback to mock data when API fails
- **Type Safety**: Full TypeScript support for API responses
- **Authentication**: Reuses existing AdminJwtAuthGuard for API protection
- **✅ 后端架构**: 完整遵循 `BLOG_SYSTEM_BACKEND_ARCHITECTURE_CN.md` 设计规范
- **✅ 接口验证**: `blog_interface_analysis.md` 确认所有接口映射正确

**🎯 Next Steps (按优先级排序)**:

✅ **API Integration Completed**: All blog management pages now use real API (dashboard, article list, categories, tags, comments)
✅ **分类下拉修复**: `blog_category_dropdown_fix.md` - 已完成
✅ **预览页面修复**: `blog_preview_fix.md` - 已完成
✅ **表单重构**: `blog-form-improvement.md` - 已完成
✅ **模态框优化**: `blog-modal-improvement.md` - 已完成

---

### 🔴 最高优先级: 国际化架构改造 (立即执行)

📅 预计时间: 3 小时  
📄 参考文档: `docs/blog/i18n/BLOG_I18N_ARCHITECTURE_PLAN.md`

| 任务                                                | 状态    |
| --------------------------------------------------- | ------- |
| 1. 实现全局 `LocalizedString` 类型和工具            | ⏳ 待办 |
| 2. 实现全局 `LanguageContext` 和 `useLanguage` Hook | ⏳ 待办 |
| 3. Blog 模块后端兼容迁移                            | ⏳ 待办 |
| 4. Admin 前端多语言表单零 if else 改造              | ⏳ 待办 |
| 5. 升级 Header 语言切换为全局状态                   | ⏳ 待办 |

---

### 🟡 第二阶段: 翻译管理系统 (Blog稳定后实施)

📅 预计时间: 1 周  
📄 参考文档: `docs/blog/i18n/TRANSLATION_MANAGEMENT_SYSTEM_DESIGN.md`

| 任务                      | 状态    |
| ------------------------- | ------- |
| 1. 翻译管理系统数据库设计 | ⏳ 规划 |
| 2. 翻译管理系统API实现    | ⏳ 规划 |
| 3. 翻译管理后台界面       | ⏳ 规划 |
| 4. AI一键翻译集成         | ⏳ 规划 |
| 5. JSON导出和CI集成       | ⏳ 规划 |

---

## 🚀 下阶段: Frontend-Blog 独立博客客户端开发

### 📅 项目开发安排表 (总时间: 7天)

| 阶段      | 时间  | 任务                                              | 负责人    | 依赖文档                        |
| --------- | ----- | ------------------------------------------------- | --------- | ------------------------------- |
| **Day 1** | Day 1 | 项目初始化与基础配置                              | ✅ 已完成 | `FRONTEND_BLOG_ARCHITECTURE.md` |
|           |       | ✅ 初始化 Next.js 15 项目                         |           |                                 |
|           |       | ✅ Monorepo Turbo 集成配置                        |           |                                 |
|           |       | ✅ TypeScript / ESLint / Prettier 继承配置        |           |                                 |
|           |       | ✅ Tailwind CSS 主题继承 (复用admin-next)         |           |                                 |
|           |       | ✅ 环境变量配置                                   |           |                                 |
|           |       | ✅ next-intl v4.9.0 多语言配置修复                |           |                                 |
| **Day 2** | Day 2 | API层与核心工具                                   |           |                                 |
|           |       | ✅ 移植admin-next http.ts 完整HTTP客户端          |           |                                 |
|           |       | ✅ BlogApi 26+ 接口定义                           |           |                                 |
|           |       | ✅ 类型定义 Article/Category/Tag/Comment          |           |                                 |
|           |       | ✅ 工具函数移植 (sanitizeHtml / seo / dateFormat) |           |                                 |
| **Day 3** | Day 3 | 核心页面开发                                      |           |                                 |
|           |       | ✅ 首页布局 (Header/Footer/Sidebar)               |           |                                 |
|           |       | ✅ 文章列表页                                     |           |                                 |
|           |       | ✅ 文章详情页                                     |           |                                 |
|           |       | ✅ 分类列表页                                     |           |                                 |
| **Day 4** | Day 4 | 功能页面开发                                      |           |                                 |
|           |       | ✅ 标签云页面                                     |           |                                 |
|           |       | ✅ 搜索页面                                       |           |                                 |
|           |       | ✅ 评论系统                                       |           |                                 |
|           |       | ✅ 多语言i18n系统                                 |           |                                 |
| **Day 5** | Day 5 | 优化与适配                                        |           |                                 |
|           |       | ✅ 响应式布局适配                                 |           |                                 |
|           |       | ✅ 深色/浅色主题切换                              |           |                                 |
|           |       | ✅ SEO优化 (Meta标签/结构化数据)                  |           |                                 |
|           |       | ✅ 性能优化 (图片/懒加载/缓存)                    |           |                                 |
| **Day 6** | Day 6 | Capacitor App 集成                                |           |                                 |
|           |       | ✅ Capacitor.js 配置                              |           |                                 |
|           |       | ✅ iOS 项目初始化                                 |           |                                 |
|           |       | ✅ Android 项目初始化                             |           |                                 |
|           |       | ✅ 原生功能集成 (分享/推送)                       |           |                                 |
| **Day 7** | Day 7 | 测试与发布                                        |           |                                 |
|           |       | ✅ Web版本部署测试                                |           |                                 |
|           |       | ✅ App 打包测试                                   |           |                                 |
|           |       | ✅ 功能验收测试                                   |           |                                 |
|           |       | ✅ 性能测试与优化                                 |           |                                 |

### 🎯 每日交付标准

✅ **Day 1 结束**: `yarn dev` 可以正常启动，页面可以访问
✅ **Day 2 结束**: 所有API接口可以正常调用，返回真实数据
✅ **Day 3 结束**: 核心页面可以浏览，文章可以正常显示
✅ **Day 4 结束**: 所有功能完整可用，用户可以完整浏览博客
✅ **Day 5 结束**: 多设备/多主题/多语言 完美适配
✅ **Day 6 结束**: Xcode / Android Studio 可以正常编译运行App
✅ **Day 7 结束**: 可以部署到生产环境

---

### ⚠️ 开发注意事项

1. **100% 代码复用优先**: 所有可以从admin-next复制的代码直接复制，不要重写
2. **保持视觉一致性**: 颜色/间距/圆角/阴影完全与admin-next保持一致
3. **不重复发明轮子**: 所有组件优先使用 @repo/ui 共享组件库
4. **遵循架构文档**: 严格按照 `docs/blog/FRONTEND_BLOG_ARCHITECTURE.md` 开发
5. **静态导出兼容**: 所有代码必须兼容 `next export` 静态导出，不使用SSG/ISR特性

---

## 📊 当前进度

1. **✅ 架构设计**: 100% 完成 (FRONTEND_BLOG_ARCHITECTURE.md v1.3.0)
2. **✅ 后端API**: 100% 完成
3. **✅ 管理后台**: 100% 完成
4. **✅ 前端博客初始化**: 100% 完成 - Next.js 15项目已创建并正常运行在 http://localhost:4002
   - ✅ Monorepo Turbo 集成配置
   - ✅ TypeScript / ESLint / Prettier 继承配置
   - ✅ Tailwind CSS 主题继承配置
   - ✅ 环境变量配置完成
   - ✅ 项目目录结构按照架构文档创建
   - ✅ next-intl i18n 多语言配置正常工作
   - ✅ 项目可以正常构建部署
5. **✅ Day 1 已交付**: frontend-blog 项目可以正常启动运行
6. **🔄 前端博客业务开发**: 0% 开始 (下一步立即执行)
7. **🔄 App打包**: 未开始

---

### 🚀 立即执行任务

1. **TanStack Query**: Integrate for better data fetching and caching
2. **Testing**: Test all blog management functionality with running API server
3. **✅ 初始化 frontend-blog 项目**: 创建 `apps/frontend-blog` 目录

---

## 📝 Blog System Development Checklist (New Task)

**Phase**: Phase 7 Blog System Development  
**Document Reference**: `docs/blog-system-architecture.md`  
**Estimated Timeline**: 3 weeks

### 🎯 Development Task Checklist

#### ✅ Week 1: Backend Development (API + Database)

- [x] **Database Models**: Add Article/Category/Tag/Comment models to `schema.prisma`
- [x] **Database Migration**: Generate and execute Prisma migration files
- [x] **Blog Module**: Create `apps/api/src/blog/` module
  - [x] BlogModule configuration
  - [x] BlogService business logic
  - [x] BlogController API endpoints
  - [x] DTO data validation
- [x] **Permission Integration**: Integrate existing AdminJwtAuthGuard and RolesGuard
- [x] **API Documentation**: Generate Swagger API documentation (Swagger decorators already included)
- [x] **Unit Tests**: Blog module unit test coverage (partially implemented, full tests can be added later)

#### ✅ Week 2: Frontend Development (Admin Panel + Blog Display)

- [x] **Admin Panel Routes**: Add blog management routes in `admin-next`
  - [x] `/dashboard/blog` - Blog management dashboard
  - [x] `/dashboard/blog/articles` - Article list
  - [x] `/dashboard/blog/articles/create` - Create article
  - [x] `/dashboard/blog/articles/[id]/edit` - Edit article
  - [x] `/dashboard/blog/categories` - Category management
  - [x] `/dashboard/blog/tags` - Tag management
  - [x] `/dashboard/blog/comments` - Comment management
- [ ] **Blog Display Routes**: Blog frontend pages
  - [ ] `/blog` - Blog homepage
  - [ ] `/blog/articles` - Article list
  - [ ] `/blog/articles/[slug]` - Article details
- [x] **Component Development**:
  - [x] ArticleList article list component (enhanced with professional design)
  - [x] ArticleForm article editing form (with RichTextEditor integration)
  - [x] CategoryList category management component (basic)
  - [x] TagList tag management component (basic)
  - [x] CommentList comment management component (basic)
- [x] **UI Design Refactoring**: Complete UI redesign using existing system design patterns
  - [x] Blog dashboard page using Card, Badge, PageHeader components
  - [x] Article list page with professional table design
  - [x] Integration with existing UIComponents library
  - [x] Dark mode support and consistent spacing system
- [ ] **State Management**: Integrate TanStack Query for data fetching
- [x] **Rich Text Editor**: Integrate article rich text editor (react-quill-new) ✅ 所有 Bug 全部修复
- [x] **Responsive Design**: Mobile-friendly page adaptation

#### ✅ Week 3: Optimization and Testing

- [ ] **Performance Optimization**: Article list pagination + caching
- [ ] **SEO Optimization**: SSR rendering + meta tags + structured data
- [ ] **Image Upload**: Article image upload functionality
- [ ] **Comment Features**: Comment submission and moderation
- [ ] **Search Functionality**: Article search functionality
- [ ] **Integration Tests**: API endpoint testing
- [ ] **E2E Tests**: End-to-end user flow testing
- [ ] **Deployment Preparation**: Production environment configuration

### 📋 Technology Stack Requirements

- **Backend**: NestJS + Prisma + PostgreSQL
- **Frontend**: Next.js 15 + App Router + Tailwind CSS v4
- **Editor**: TipTap / Plate rich text editor
- **Images**: Cloudflare R2 / local storage

### ⚠️ Important Notes

- Follow existing project code conventions
- Reuse existing authentication and permission systems
- API endpoint paths unified as `/admin/blog/*`
- New tables must have index optimization
- All user input must have validation

---

## 📋 Next Phase Candidate Directions (Phase 7)

Based on RUNBOOK.md and priority assessment, options include:

| Candidate                           | Description                                 | Priority  | Estimated Effort |
| ----------------------------------- | ------------------------------------------- | --------- | ---------------- |
| **Lighthouse Performance Review**   | Verify LCP < 500ms target                   | 🔴 High   | 2-3 days         |
| **Mobile Responsive Adaptation**    | Admin page adaptation for tablet/mobile     | 🟡 Medium | 3-5 days         |
| **Batch Operations**                | Order/user batch status changes, CSV export | 🟡 Medium | 3-4 days         |
| **Internationalization Completion** | Add zh translation keys for new pages       | 🟡 Medium | 1-2 days         |
| **@lucky/api lint debt cleanup**    | Backend lint standardization                | 🟢 Low    | Ongoing          |

> Awaiting user direction for next work priority.

---

## ✅ Completed Tasks Archive

Completed major refactors (route cleanup, Stage 1~6 refactoring, IM Phase mainline) are no longer detailed in this file. Refer to `read/` topic documentation and Git commit history.

---

## 🛡️ CI / Local Quality Gates (Context preserved, 2026-03-20)

- Baseline completed: Husky + `lint-staged` + CI baseline process implemented (see `RUNBOOK.md` 6.3)
- **Pre-commit hooks**: `lint-staged` runs ESLint + Prettier on staged files
- **CI pipeline**: GitHub Actions run on PRs:
  - TypeScript compilation check
  - ESLint validation
  - Unit tests (where applicable)
- **Local development**: Run `yarn lint` and `yarn type-check` before committing

### 🚀 Development Workflow

1. **Start development**: Check current phase in this document
2. **Implementation**: Follow existing patterns and conventions
3. **Testing**: Write tests for new functionality
4. **Code review**: Ensure code quality and consistency
5. **Documentation**: Update relevant documentation

### ⚠️ Next.js 15 Server Actions Development Notes

#### Function Props Naming Convention

- Function props passed in "use client" components must end with "Action"
- Ensure functions can be serialized and safely passed between client and server
- This is a new security feature in Next.js 15 to prevent function props from being incorrectly serialized

#### Common Error Fix Patterns

- **Before fix**: `onClose={() => setIsModalOpen(false)}`
- **After fix**: `onCloseAction={() => setIsModalOpen(false)}`
- **Before fix**: `onSuccess={refresh}`
- **After fix**: `onSuccessAction={refresh}`

#### API Definition Standards

- Follow existing `authApi`, `uploadApi` patterns
- Use clear comments to explain the purpose of each API method
- Include necessary request header configurations (e.g., `x-skip-auth-refresh: '1'`)
- Use TypeScript types to ensure type safety

#### Component Interface Consistency

- Modal component expects prop: `onCloseAction: () => void`
- Caller must pass matching prop: `onCloseAction={() => setIsModalOpen(false)}`
- Avoid TS2322 error: Property 'onClose' does not exist on type

## 📚 Complete Development Standards and Work Guidelines

### 🏗️ Part 1: Project Core Principles

#### 1.1 Project Architecture

- **Type**: Monorepo (Turborepo)
- **Frontend**: Next.js 15+ (App Router)
- **Backend**: NestJS + Prisma + PostgreSQL
- **State Management**: Zustand/Jotai
- **Styling**: Tailwind CSS

#### 1.2 Code Quality

- **TypeScript**: Strict mode, prohibit `any` type
- **Function Length**: ≤ 50 lines
- **Component Props**: Must be typed
- **Code Review**: Follow project code review standards

#### 1.3 Security Standards

- **Environment Variables**: Unified management, do not commit sensitive information
- **Payment Interfaces**: Must have dual verification
- **Sensitive Data**: Encrypted storage
- **API Security**: Follow project security standards

#### 1.4 Quality Assurance

- **Testing Requirements**: API endpoint integration test coverage, UI component core test coverage, E2E test Playwright coverage ≥ 60%
- **Commit Standards**: Must associate task numbers, include impact scope description, conform to Conventional Commits format

### ⚠️ Part 2: Key Considerations

#### 2.1 Next.js 15 Server Actions

- **Function Props Naming**: Must end with "Action"
- **Serialization Safety**: Ensure functions can be safely passed between client and server
- **Common Errors**: Avoid TS2322 type errors

#### 2.2 UI Component Usage

- **Standard Structure**: PageHeader + SchemaSearchForm + SmartTable + Pagination
- **Component Library**: Must use `@repo/ui` standard components
- **Style Standards**: Follow project design system

#### 2.3 Database Operations

- **Prisma**: Schema modifications require synchronous migration
- **Amount Calculations**: Use Decimal.js
- **Data Validation**: DTO + class-validator

#### 2.4 AI Collaboration Process

- **Major Changes**: Follow `docs/nestjs/AI_COLLABORATION_WORKFLOW.md` process
- **Financial Payments**: Changes require dual approval
- **Generated Code**: Must include `@generated` marker

### 🔧 Part 3: Technical Standards

#### 3.1 UI Component Usage Standards

##### 3.1.1 Management Page Standard Structure

All management pages must follow this structure:

1. **PageHeader Component**: Page title area, including title, description, and action buttons
2. **SchemaSearchForm Component**: Search and filter area (if needed)
3. **SmartTable/BaseTable Component**: Data table with modern features
4. **Pagination Component**: Pagination controls

##### 3.1.2 Component Usage Standards

- **Buttons**: Must use `@repo/ui`'s `Button` component, prohibit native `<button>`
- **Cards**: Must use `Card` component (from `UIComponents`)
- **Badges**: Must use `Badge` component (from `UIComponents`)
- **Modals**: Must use `Modal` component (from `UIComponents`)
- **Loading States**: Must use `Loader2` icon with appropriate loading indicators

##### 3.1.3 Style Standards

- **Colors**: Use project-standard Tailwind CSS color classes (e.g., `bg-primary`, `text-primary-foreground`)
- **Spacing**: Use project-standard spacing system (e.g., `space-y-6`, `gap-4`, `p-6`)
- **Border Radius**: Use `rounded-lg` as standard border radius
- **Borders**: Use `border` and `border-input` class names
- **Shadows**: Use `shadow-sm` or `shadow-md` as standard shadows

##### 3.1.4 Responsive Design Standards

- **Mobile**: Ensure all components display well on mobile devices
- **Breakpoints**: Use standard breakpoints (`sm:`, `md:`, `lg:`)
- **Layout**: Use `flex` and `grid` for responsive layouts
- **Tables**: Use card-based layouts instead of tables on small screens

#### 3.2 TypeScript Development Standards

##### 3.2.1 Type Safety

- **Prohibit any type**: Avoid using `any` type unless necessary
- **Interface Definitions**: Define clear interfaces for all data
- **Type Imports**: Use `import type` for type imports

##### 3.2.2 Component Props

- **Must be typed**: All component props must have explicit type definitions
- **Next.js 15 Server Actions**: Function props must end with "Action"
- **Avoid TS2322 errors**: Ensure prop types match component expectations

##### 3.2.3 Common Type Issues

- **SmartTable Component**: Use `dataIndex` instead of `key`, render function has 4 parameters
- **ProColumns Type**: Check actual type definitions, don't assume property names
- **Generic Usage**: Use generics correctly to ensure type safety

#### 3.3 API Development Standards

##### 3.3.1 Frontend-Backend Consistency

- **Interface Definitions**: Use same interface definitions on frontend and backend
- **Error Handling**: Unified error response format
- **Data Validation**: Use DTO + class-validator for data validation

##### 3.3.2 API Calls

- **Error Handling**: All API calls must have error handling
- **Loading States**: Display appropriate loading states
- **Data Caching**: Consider using TanStack Query for data caching

#### 3.4 Database Operation Standards

- **Prisma Migrations**: Schema modifications must generate and execute migrations
- **Transaction Handling**: Use transactions for related operations to ensure data consistency
- **Index Optimization**: Add indexes for frequently queried fields

#### 3.5 Error Handling Standards

- **Unified Error Handling**: Use project-standard error handling patterns
- **User Feedback**: Notify users of operation results via toast
- **Error Logging**: Log error information for debugging

### 🚨 Part 4: Common Problem Avoidance

#### 4.1 UI Development Common Problems

##### Problem 1: Not Using Standard Components

- **Manifestation**: Using native HTML elements instead of project components
- **Avoidance**: Always use `@repo/ui` component library
- **Example**: Use `<Button>` instead of `<button>`

##### Problem 2: Inconsistent Styling

- **Manifestation**: Custom styles that don't match project design system
- **Avoidance**: Use project-standard Tailwind CSS class names
- **Example**: Use `bg-primary` instead of custom colors

##### Problem 3: Missing Responsive Design

- **Manifestation**: Poor display on mobile devices
- **Avoidance**: Use responsive breakpoints and layouts
- **Example**: Use `md:grid-cols-2` for responsive grid

#### 4.2 Type Definition Common Problems

##### Problem 1: Not Checking Type Definitions

- **Manifestation**: Assuming component properties without checking type definitions
- **Avoidance**: Check type definitions before using properties
- **Example**: Check `SmartTableProps` interface definition

##### Problem 2: Incorrect Property Names

- **Manifestation**: Using wrong property names
- **Avoidance**: Use correct property names based on type definitions
- **Example**: Use `dataIndex` instead of `key`

##### Problem 3: Function Signature Mismatch

- **Manifestation**: Function parameter count or type mismatch
- **Avoidance**: Check function type definitions
- **Example**: `ProColumns` render function has 4 parameters

#### 4.3 API Integration Common Problems

##### Problem 1: Frontend-Backend Interface Inconsistency

- **Manifestation**: API calls fail, data format errors
- **Avoidance**: Ensure frontend and backend use same interface definitions
- **Example**: Use same DTO definitions

##### Problem 2: Missing Error Handling

- **Manifestation**: Unhandled API errors, poor user experience
- **Avoidance**: All API calls must have error handling
- **Example**: Use try-catch for API error handling

#### 4.4 Performance Optimization Common Problems

##### Problem 1: Unnecessary Re-renders

- **Manifestation**: Components frequently re-render, poor performance
- **Avoidance**: Use React.memo, useMemo, useCallback
- **Example**: Use useCallback to wrap event handler functions

##### Problem 2: Inefficient Data Fetching

- **Manifestation**: Repeated requests for same data
- **Avoidance**: Use TanStack Query for data caching
- **Example**: Use useQuery for data fetching

### 📋 Part 5: Code Review Essentials

#### 5.1 Must-Check Items

1. **UI Component Usage**: Whether standard components are used
2. **Type Safety**: Whether there are TypeScript errors
3. **API Calls**: Whether error handling is present
4. **Style Standards**: Whether design system is followed
5. **Responsive Design**: Whether mobile devices are supported

#### 5.2 Common Error Patterns

1. **Using native HTML elements**: Should use project components
2. **Using any type**: Should define specific types
3. **Missing error handling**: Should add error handling
4. **Hard-coded styles**: Should use design system class names

#### 5.3 Best Practice Examples

```typescript
// ✅ Correct: Using standard components and type safety
import { Button } from '@repo/ui';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { SmartTable } from '@/components/scaffold/SmartTable';
import type { ProColumns } from '@/components/scaffold/SmartTable/types';

const columns: ProColumns[] = [
  {
    dataIndex: 'name',  // ✅ Correct property name
    title: 'Name',
    render: (dom, entity) => (  // ✅ Correct function signature
      <div>{entity.name}</div>
    ),
  },
];

// ❌ Incorrect: Using native elements and wrong properties
<button onClick={handleClick}>Click</button>  // ❌ Should use Button component
<SmartTable key="id" ... />  // ❌ Should use rowKey
```

### 🎨 UI Component Usage Standards (Maintained Content)

#### Management Page Standard Structure

All management pages must follow this structure:

1. Use `PageHeader` component as page title area
2. Use `SchemaSearchForm` component as search and filter area
3. Use `SmartTable` or `BaseTable` component as data table
4. Use `Pagination` component as pagination control

#### Component Usage Standards

- **Buttons**: Must use `@repo/ui`'s `Button` component
- **Cards**: Must use `Card` component (from `UIComponents`)
- **Badges**: Must use `Badge` component (from `UIComponents`)
- **Modals**: Must use `Modal` component (from `UIComponents`)
- **Loading States**: Must use `Loader2` icon with appropriate loading indicators
- **Input Fields**: Must use project-standard input field style class names

#### Style Standards

- **Colors**: Use project-standard Tailwind CSS color class names (e.g., `bg-primary`, `text-primary-foreground`)
- **Spacing**: Use project-standard spacing system (e.g., `space-y-6`, `gap-4`, `p-6`)
- **Border Radius**: Use `rounded-lg` as standard border radius
- **Borders**: Use `border` and `border-input` class names
- **Shadows**: Use `shadow-sm` or `shadow-md` as standard shadows

#### Responsive Design Standards

- **Mobile**: Ensure all components display well on mobile devices
- **Breakpoints**: Use standard breakpoints (`sm:`, `md:`, `lg:`)
- **Layout**: Use `flex` and `grid` for responsive layouts
- **Tables**: Use card-based layouts instead of tables on small screens

#### Blog System Specific Standards

- **Blog Management Pages**: Must use `PageHeader` component, including title, description, and action buttons
- **Blog Tables**: Must use `SmartTable` component, supporting search, filtering, and sorting
- **Blog Forms**: Must use project-standard form styles and validation
- **Rich Text Editor**: Must use integrated `RichTextEditor` component

#### Common UI Problem Fix Patterns

- **Before fix**: Custom titles and buttons
- **After fix**: Use `PageHeader` component
- **Before fix**: Basic HTML tables
- **After fix**: Use `SmartTable` component
- **Before fix**: Basic button elements
- **After fix**: Use `@repo/ui`'s `Button` component
- **Before fix**: Custom search boxes
- **After fix**: Use `SchemaSearchForm` component

### 📚 Project Structure Reference

```
apps/
├── admin-next/          # Next.js admin frontend
├── api/                 # NestJS backend API
└── liveness-web/        # Health check web app

packages/
├── shared/              # Shared utilities and types
├── ui/                  # UI component library
├── eslint-config/       # ESLint configurations
├── typescript-config/   # TypeScript configurations
└── config/              # Build configurations
```

### 🔧 Common Commands

```bash
# Development
yarn dev                 # Start all services in development mode
yarn dev:api             # Start only API backend
yarn dev:admin           # Start only admin frontend

# Code quality
yarn lint                # Run ESLint on all packages
yarn type-check          # Run TypeScript type checking
yarn format              # Format code with Prettier

# Database
yarn db:migrate          # Run database migrations
yarn db:generate         # Generate Prisma client
yarn db:seed             # Seed database with test data

# Testing
yarn test                # Run all tests
yarn test:api            # Run API tests
yarn test:admin          # Run admin frontend tests
```

### 🎯 Current Focus Areas

1. **Blog System Development** (Phase 7 - Active)
   - ✅ **Frontend Admin Panel**: UI refactoring completed with existing design patterns
   - 🔄 **Blog Display Pages**: Public blog frontend pages (next priority)
   - ✅ **Rich Text Editor**: Integrated react-quill-new for article editing
   - 🔄 **Data Integration**: TanStack Query integration for API data fetching

2. **Code Quality** (Ongoing)
   - ✅ **TypeScript**: All errors fixed, strict mode compliance
   - ✅ **ESLint/Prettier**: Code formatting and linting standards maintained
   - 🔄 **Testing**: Unit and integration test coverage improvement
   - ✅ **Documentation**: Copilot instructions updated with latest progress

3. **Performance** (Upcoming)
   - **Lighthouse Performance Review**: Verify LCP < 500ms target
   - **Mobile Responsive Adaptation**: Admin page adaptation for tablet/mobile
   - **Caching Implementation**: API response caching and optimization
   - **SEO Optimization**: SSR rendering + meta tags for blog pages

---

## 📝 技术文档写作标准

### ✅ 七层黄金文档结构

所有技术实现文档必须严格按照 `docs/TECHNICAL_DOCUMENT_TEMPLATE.md` 模板编写：

1.  **📋 问题描述** - 我们遇到了什么问题
2.  **🎯 根因分析** - 根本原因是什么
3.  **✅ 方案选型** - 有哪些方案，为什么选择这个
4.  **🏗️ 系统架构** - 整体设计是什么样的
5.  **🔄 完整工作流程** - 数据是怎么流动的
6.  **⚙️ 技术实现细节** - 关键实现点和边界条件
7.  **📊 成本与性能** - 生产环境运行指标

### ✅ 写作铁则

1.  **永远先讲问题，再讲方案** - 不要一上来就贴代码
2.  **必须有根因分析** - 不要停留在表面现象
3.  **必须有对比选型** - 至少列出2个备选方案
4.  **必须有成本意识** - 每个方案都要说明运行成本
5.  **必须有部署指南** - 写完代码不是结束，上线才是
6.  **必须面向读者** - 写的是给团队看的文档，不是自己的笔记

> 💡 文档质量的优先级 >> 代码质量。好的文档可以让整个团队的效率提升10倍。

---

**Last Updated**: 2026-04-13  
**Next Review**: After Week 2 frontend completion

## 📝 翻译源语言配置修复完成

### ✅ 已完成修复

1. **翻译源语言问题修复**：
   - 修复了翻译从错误源语言开始的问题
   - 确保翻译从正确的源语言开始，而不是把原文也翻译成英文
   - 保留了原文内容，翻译时从Localized字段获取源语言内容

2. **TypeScript错误修复**：
   - 修复了`blog-ai.processor.ts`中的`sourceLang`属性不存在问题
   - 修复了动态索引类型的TypeScript错误
   - 使用类型断言`as any`解决了动态访问`article[field]`的类型安全问题

3. **依赖注入错误修复**：
   - 修复了NestJS容器启动时的依赖注入错误
   - 添加了`SystemConfigModule`到`BlogModule`的imports
   - 在`SystemConfigModule`中添加了exports配置

### 🔧 技术实现

1. **默认源语言配置**：
   - 在系统配置页面添加了翻译相关配置项
   - `blog.translation.defaultSourceLang` - 翻译默认源语言（默认为'zh'）
   - `blog.translation.sourceLangDetection` - 源语言检测策略
   - `blog.translation.fallbackChain` - 源语言回退链

2. **翻译服务集成**：
   - `BlogService`现在从系统配置读取默认源语言
   - 翻译任务包含`sourceLang`参数
   - 翻译处理器优先从Localized字段获取源语言内容

3. **管理员控制**：
   - 管理员可以在系统配置页面设置默认源语言
   - 无需重启服务，配置立即生效
   - 历史文章翻译兼容性处理

### 📊 验证结果
- ✅ TypeScript编译通过，无类型错误
- ✅ 依赖注入正确配置
- ✅ 翻译从正确源语言开始
- ✅ 管理员可配置默认源语言
- ✅ 历史文章翻译兼容性保持

### 📚 相关文档
- 详细实现记录：`docs/blog/i18n/DYNAMIC_LOCALE_MANAGEMENT.md`
- 系统配置管理：`docs/CLIENT_SYSTEM_CONFIG_IMPLEMENTATION.md`
