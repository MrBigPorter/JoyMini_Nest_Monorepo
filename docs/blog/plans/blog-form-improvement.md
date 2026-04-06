# 博客系统表单组件与 Zod 验证问题总结

## 当前状态（截至 2026-04-05）

博客系统管理面板的基础功能已实现，但在表单层面存在以下问题：

### 1. 表单组件未统一使用封装好的 `@repo/ui` 组件

| 页面/组件                          | 当前使用组件                                 | 问题                                                                                                     |
| ---------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `blog/articles/create/page.tsx`    | 原生 `<input>`、`<textarea>` 配合 `register` | 未使用 `FormTextField`、`FormTextareaField` 等封装组件，导致样式不一致、缺少统一错误提示、无障碍支持不足 |
| `blog/articles/[id]/edit/page.tsx` | 原生 `<input>`、`<textarea>` 配合 `useState` | 完全未使用 `react-hook-form` 和 Zod，验证逻辑缺失，状态管理繁琐                                          |
| `blog/categories/page.tsx`         | 原生 `<input>` 内联表单                      | 未使用模态框，也未使用封装表单组件                                                                       |
| `blog/tags/page.tsx`               | 原生 `<input>` 内联表单                      | 同上                                                                                                     |
| `blog/comments/page.tsx`           | 操作按钮直接调用 API                         | 无表单，但审核/回复操作可考虑使用模态框与表单组件                                                        |

### 2. Zod 验证未全面集成

- **已有 Zod Schema**：`apps/admin-next/src/schema/blog.ts` 已定义 `articleSchema`、`categorySchema`、`tagSchema`、`commentModerationSchema`
- **实际使用情况**：
  - `BlogArticleModal` 使用了 `articleSchema` 和 `useBlogForm`（集成 Zod）
  - `BlogCategoryModal`、`BlogTagModal`、`BlogCommentModal` 也使用了对应的 Schema
  - **但页面级表单（创建/编辑文章）未使用这些 Schema**，导致验证逻辑重复或缺失

### 3. 表单模式不一致

项目目前存在两种表单模式：

**模式 A（旧）**：`useBlogForm` + `register` + 原生 `<input>` 或 `FormTextField` 搭配 `{...register('field')}`

- 示例：`BlogArticleModal`
- 优点：集成了 toast 错误处理
- 缺点：未充分利用 `Form` Provider 的自动关联，组件绑定较繁琐

**模式 B（新）**：`useForm` + `Form` Provider + `FormTextField` 仅用 `name` 属性

- 示例：`CreateProductFormModal`
- 优点：符合 `@repo/ui` 设计理念，代码简洁，自动关联验证
- 缺点：未集成 toast 错误处理（需手动添加）

### 4. 数据获取未使用 TanStack Query

- 文章列表页面已导入 `@tanstack/react-query` 但未实际使用
- 分类、标签、评论页面仍使用 `useState` + `useEffect` + `fetch` 模式
- 缺少缓存、乐观更新、自动重试等现代数据获取特性

### 5. 客户端导航未完全替换

- `blog/articles/page.tsx` 中的 `window.location.href` 已替换为 `router.push`
- 需复查其他页面（如 `blog/page.tsx` 中可能仍有类似跳转）

## 改进目标

1. **统一表单组件**：所有博客管理表单使用 `@repo/ui` 的 `FormTextField`、`FormTextareaField`、`FormSelectField`、`FormMediaUploaderField` 等组件
2. **全面集成 Zod 验证**：所有表单必须通过 Zod Schema 进行验证，错误信息统一显示
3. **选择最佳表单模式**：推荐采用 **模式 B（Form Provider + name 属性）**，因其更符合组件库设计，且已在其他模块（如商品管理）中验证成功
4. **引入 TanStack Query**：所有数据获取操作迁移到 `useQuery` / `useMutation`，提升性能与开发体验
5. **消除 `window.location.href`**：确保所有导航使用 Next.js 的 `useRouter`

## 详细实施步骤

### 阶段一：统一表单模式与组件

1. **确定表单模式**：决定采用模式 B（Form Provider），并创建共享的 `useBlogFormV2` 钩子（可选），集成 toast 错误处理
2. **迁移文章创建页面** (`create/page.tsx`)：
   - 替换原生 `<input>`/`<textarea>` 为 `FormTextField`、`FormTextareaField`
   - 使用 `Form` Provider 包裹表单
   - 保留现有的 `useBlogForm` 或改用 `useForm` + `zodResolver`
   - 分类选择改用 `FormSelectField`（下拉）或保留按钮组（需设计）
   - 标签选择保留多选按钮，但改用 `Form` 控制
3. **迁移文章编辑页面** (`edit/page.tsx`)：
   - 同上，同时需要加载初始数据（可使用 `useQuery` 获取文章详情）
   - 集成 `useBlogForm` 或 `useForm` 并设置 `defaultValues`
4. **迁移分类、标签、评论页面**：
   - 将内联表单改为模态框（已有 `BlogCategoryModal` 等）或保留页面但使用封装组件
   - 确保使用对应的 Zod Schema

### 阶段二：集成 TanStack Query

1. **文章列表页面** (`articles/page.tsx`)：
   - 使用 `useQuery` 获取文章列表，支持分页、过滤
   - 使用 `useMutation` 处理删除、发布/下架操作
   - 更新后自动刷新列表（失效查询）
2. **分类、标签、评论页面**：
   - 类似地使用 `useQuery` 获取数据
   - 使用 `useMutation` 处理增删改
3. **API 调用统一**：确保所有 `blogApi` 方法被 TanStack Query 包裹，充分利用缓存

### 阶段三：客户端导航复查

1. 搜索整个 `apps/admin-next/src` 中残留的 `window.location.href`，替换为 `router.push`
2. 检查是否有硬编码的 `href` 导致全页面刷新，改为 `Link` 组件

### 阶段四：测试与优化

1. 验证所有表单功能正常（创建、编辑、验证、错误提示）
2. 验证 TanStack Query 缓存行为符合预期
3. 检查页面性能，确保无多余重渲染

## 风险与缓解

| 风险                             | 影响 | 缓解措施                                                                         |
| -------------------------------- | ---- | -------------------------------------------------------------------------------- |
| 表单模式切换导致现有模态框不兼容 | 中   | 先在小范围（文章创建页面）试点，确认无问题后再推广到其他页面；保留旧模式作为备选 |
| Zod Schema 与 API 接口不一致     | 低   | 对照现有 API 文档，确保 Schema 字段与接口字段匹配；运行时可通过 `transform` 适配 |
| TanStack Query 集成后数据不一致  | 中   | 仔细设计 Query Key，确保更新后正确失效；使用乐观更新提升用户体验                 |
| 样式不一致                       | 低   | 使用 `@repo/ui` 组件本身已保证样式统一，只需检查自定义样式是否冲突               |

## 预期收益

- **开发效率提升**：表单编写更快，验证逻辑更清晰
- **用户体验改善**：统一的错误提示、加载状态、无障碍支持
- **代码可维护性增强**：减少重复代码，强类型验证，易于扩展
- **性能提升**：数据缓存减少请求，客户端导航减少全页面刷新

## 后续扩展

- **表单抽象**：可进一步提取通用表单布局组件（如 `BlogArticleForm`）
- **实时协作**：考虑集成 Yjs 实现多人协同编辑（远期）
- **国际化**：表单标签、错误消息支持多语言

---

**下一步**：请审阅此问题总结与改进方案，确认实施优先级与范围。若无异议，可切换到代码模式开始执行。
