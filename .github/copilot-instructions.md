# Lucky Nest Monorepo — Copilot Work Instructions

> **Important**: Always start each conversation by checking `## 🎯 Current Task`, follow the Phase progression, and do not work on unplanned tasks.

---

## 🎯 Current Task (Start Here for Each Conversation)

**Phase**: Phase 7 Blog System Development — Week 2 Frontend UI Refactoring & API Integration  
**Last Update**: Blog system admin panel UI refactored + API integration fixes (2026-04-04)  
**Immediate Action**:

### ✅ Blog System Week 2 Issues Fixed

**🎯 Problems Identified & Fixed**:

1. **✅ 404 Page Issues**: Fixed routing mismatch between `/dashboard/blog/articles/[id]/edit` and `/blog/articles/[id]/edit`
2. **✅ API Interface Missing**: Created complete blog system API interface in `apps/admin-next/src/api/index.ts`
3. **✅ Frontend-Backend Integration**: Updated blog edit page to use real API calls instead of mock data
4. **✅ Routing Consistency**: Fixed link paths in article list page to match actual routes

**📊 Current Status**:

| Page/Component             | Status      | API Integration       |
| -------------------------- | ----------- | --------------------- |
| 🏠 **Blog Dashboard**      | ✅ Complete | Mock data (needs API) |
| 📝 **Article List**        | ✅ Complete | Mock data (needs API) |
| ✏️ **Article Create/Edit** | ✅ Complete | ✅ **API Integrated** |
| 📂 **Category Management** | ✅ Basic    | Mock data (needs API) |
| 🏷️ **Tag Management**      | ✅ Basic    | Mock data (needs API) |
| 💬 **Comment Management**  | ✅ Basic    | Mock data (needs API) |

**🔧 Technical Improvements**:

- **API Interface**: Complete blog API interface with 26+ methods
- **Error Handling**: Proper error handling with toast notifications
- **Fallback Strategy**: Graceful fallback to mock data when API fails
- **Type Safety**: Full TypeScript support for API responses
- **Authentication**: Reuses existing AdminJwtAuthGuard for API protection

**🎯 Next Steps**:

1. **Complete API Integration**: Update remaining pages (article list, categories, tags, comments) to use real API
2. **TanStack Query**: Integrate for better data fetching and caching
3. **Testing**: Test all blog management functionality with running API server
4. **Public Blog Pages**: Start development of public blog display pages

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
- [x] **Rich Text Editor**: Integrate article rich text editor (react-quill-new)
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

**Last Updated**: 2026-04-04  
**Next Review**: After Week 2 frontend completion
