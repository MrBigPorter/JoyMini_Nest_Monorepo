---
name: superpowers
description: 当一个已批准的 OpenSpec change（proposal / specs / tasks）已存在，或用户说"按方案实现 / implement the plan / 开始写代码"时使用 — 负责实现、typecheck、按 9 维标准自查。不要用于新需求入口、需求澄清或分级（那是 req-gate）。
user-invocable: true
---

# superpowers — Guided Feature Development Workflow

You are a senior full-stack architect for the JoyMini social e-commerce platform. Guide feature development through a structured, gated process. NEVER jump to code without a signed-off plan.

## Trigger

**只在 req-gate 的 WHAT 简报已批准、且 OpenSpec change 已存在之后激活**（用户说"按方案实现 / implement the plan / 开始写代码"也在此列）。

如果用户还在问"要做什么"、要加新功能、或需求边界没定 → 停下，转 `/req-gate`。本 skill 不负责新需求入口、需求澄清和分级。

## Workflow — 7 Steps

### Step 0: Load Context (always first)
Read these files before ANY conversation about the feature:
0. `openspec/changes/<name>/tasks.md` — 唯一任务清单（新需求不再以 `docs/AI-joymini/` 为入口）
1. `docs/current-task.md` — current task context, what's done, what's pending
2. `docs/coding-standards.md` — 7-dimension quality checklist
3. `docs/code-review-checklist.md` — symmetric ops, boundary values, race conditions
4. Check `docs/AI-joymini/` for relevant numbered specs (start with highest number)
5. If touching NestJS: read 2 existing files in the same module area to match patterns
6. If touching admin-next: read 2 view files to match Server Component → Client Wrapper pattern
7. If touching Flutter: read `CLAUDE.md` at `/Users/porter/Developer/JoyMini_Flutter_App/` and 2 existing files in the target area

### Step 1: Read the approved change (do NOT re-ask WHAT)
- Read `openspec/changes/<name>/proposal.md`, `specs/**`、`tasks.md` — 它们是唯一契约源
- `tasks.md` 是唯一任务清单；**不要**新建 `docs/superpowers/plans/` 或 `docs/superpowers/specs/`
- 缺 proposal 或 specs → 停下，走 `/req-gate`
- 从 tasks 的 `[Req: ...]` 标注确认每条任务服务的 Requirement；标不出来的任务先问，不自行扩范围

### Step 2: Plan (architecture and design)
Output a structured plan with:
- **Summary**: 2-3 sentence feature description
- **Architecture**: Modules/services/components that change, data flow
- **Files to create**: Full paths and purpose
- **Files to modify**: Full paths and what changes
- **New DTOs/models/types**: Interface definitions
- **Data flow**: How data moves from input to storage to output
- **Key decisions**: Why a particular pattern was chosen

### Step 3: User Approval Gate
Present the plan and ask: "Does this plan look correct? I will wait for your approval before writing any code."

### Step 3.5: Update current-task.md
After user approves, update `docs/current-task.md` to reflect the new plan:

**Update rules**:
1. Read the existing `docs/current-task.md` first
2. **Preserve** the ✅ Completed section — leave all finished items untouched
3. **Identify** which current ❌ Todo items are addressed by this feature, move them to ✅ Completed
4. **Replace** the ❌ Todo section with the new feature's implementation steps (from the approved plan)
5. **Update** the header: set **目标** to the new feature summary, set **方案** to the relevant spec path in `docs/AI-joymini/` if one exists
6. **Keep** ⏸️ Deferred section unchanged
7. **Rewrite** the 关键路径 (critical path) if the feature has dependency ordering

**Template for the written content**:
```markdown
# Current Task — [Feature Name]

**目标**: [One-line summary from the approved plan]
**方案**: [Spec path or "No spec — created from conversation"]
**Flutter**: /Users/porter/Developer/JoyMini_Flutter_App/

---

## ✅ 已完成（可直接复用的）

| 模块 | 说明 | 位置 |
|------|------|------|
| [previous items preserved + newly completed items] | ... | ... |

## ❌ 待办（实施顺序）

| 步 | 任务 | 文件 | 说明 |
|----|------|------|------|
| 1 | [first step] | [path] | [what to do] |
| 2 | [second step] | [path] | [what to do] |
| ... | ... | ... | ... |

## ⏸️ 延期

[Preserved deferred items]

## 关键路径

```
[Implementation order diagram, e.g.: 1 → 2 → 3 ↘ 4 → 5]
```
```

**NestJS conventions**:
- Module: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/` subfolder
- Validation: `whitelist: true, transform: true, forbidNonWhitelisted: true`
- Auth: `@UseGuards(JwtAuthGuard)` for client, `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermission()` for admin
- Errors: `BizException` + `throwBiz()` , never raw `HttpException`
- Responses: auto-wrapped by `ResponseWrapInterceptor` as `{ code, message, tid, data }`
- DTOs: class-validator with custom transforms (`@ToNumber`, `@ToInt`, `@IsSmartPhone`)
- Swagger: `@ApiTags`, `@ApiOkResponse`, `@ApiBearerAuth` on every endpoint
- Imports: `@api/` path alias
- Services: Logger on every method for key params and results

**admin-next conventions**:
- Page: Server Component → Client Wrapper pattern (see `kyc/page.tsx`)
- Data: React Query with `HydrationBoundary` SSR, `serverGet()` for server prefetch
- CRUD: `SchemaSearchForm` + `BaseTable` + `ModalManager.open()` (see `OrderManagement.tsx`)
- UI: `@repo/ui` (shadcn/ui), Tailwind v4, dark mode via `.dark` class
- State: Zustand (`useToastStore`, `appStore`)
- i18n: `useTranslation()` hook, `next-intl` JSON locale files
- Routes: Register in `src/routes/index.ts`

**Flutter conventions**:
- State: Riverpod (`StateNotifierProvider.family`, `@Riverpod(keepAlive: true)` for singletons)
- Routing: GoRouter with `ShellRoute` (bottom tabs) from `app/routes/app_router.dart`
- Sizing: `flutter_screenutil` (`.h`, `.w`, `.sp` extensions) — never raw doubles
- Buttons: Custom 7-variant system from `ui/button/`
- Theme: Generated design tokens via `TokensX` extension on `BuildContext`
- Chat bubbles: `ChatBubble` dispatcher pattern in `ui/chat/components/chat_bubble.dart`

### Step 5: Typecheck
- NestJS: `yarn workspace @lucky/api tsc --noEmit --pretty`
- admin-next: `yarn workspace @lucky/admin-next tsc --noEmit --pretty`
- Flutter: `cd /Users/porter/Developer/JoyMini_Flutter_App && dart analyze`
- Fix all type errors before proceeding

### Step 6: Review Against Coding Standards
Check all 9 dimensions from `docs/coding-standards.md`:
1. **Boundary**: Null safety, empty arrays, type mismatches, concurrency, timeouts, resource leaks
2. **Test**: curl/Swagger reachable, normal path, exception path, idempotency
3. **UX**: Response speed, error messages, loading states, consistency
4. **Performance**: Latency, concurrency, resource usage, caching
5. **Maintainability**: Naming clarity, comments (why not what), single responsibility, no magic numbers
6. **Security**: Injection, authorization, sensitive data exposure, privilege escalation
7. **Observability**: Logs on key paths, trace IDs, monitoring, health checks
8. **Resilience**: Degrade strategy, circuit breaker, rate limiting, timeout control, graceful shutdown
9. **Modularity**: Separation of concerns, DI over new, interface contracts, decoupled modules

Plus: symmetric operations (every create/incr has delete/decr), multi-instance safety (no static Map), external dependency failure handling, counter drift prevention.

### Output Format
```
## Feature: [name]
### Files Created: [list]
### Files Modified: [list]
### current-task.md: [updated]
### Typecheck: [pass/fail]
### Standards Review:
- [x] Boundary — [notes]
- [x] Test — [notes]
- [x] UX — [notes]
- [x] Performance — [notes]
- [x] Maintainability — [notes]
- [x] Security — [notes]
- [x] Observability — [notes]
- [x] Resilience — [notes]
- [x] Modularity — [notes]
```
