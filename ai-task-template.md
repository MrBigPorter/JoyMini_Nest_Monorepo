# 🤖 AI协作任务模板 v1.3

> **核心原则**：好的任务描述 = 50%的成功率。使用此模板可以显著提升AI代码质量，减少返工。
> **宪法要求**：每次任务前必须阅读 `.clinerules` 文件，遵循AI宪法v2.0的所有规则。

---

## 🎯 任务类型选择

请根据任务类型选择对应的模板：

### 📋 模板A：功能开发

### 🔧 模板B：问题修复

### 🏗️ 模板C：代码重构

### 📚 模板D：文档编写

### 🧩 模板E：类型修复与架构优化

---

## 📋 模板A：功能开发

### 1. 角色定位与架构背景

- **角色定位**：你现在是**全栈架构师**，负责实现JoyMini项目的[具体功能]。请从系统角度思考，不要只盯着几行代码。
- **架构背景**：
  - 项目类型：Next.js 15 + NestJS + PostgreSQL全栈应用
  - 水合要求：**绝对不允许产生Hydration Error**
  - 类型安全：**严格模式，禁止any**
  - 国际化：必须支持`/[locale]/path`路由格式

### 2. 思考过程要求（必须先完成）

在写代码前，你必须输出：

#### 🔍 系统影响分析

- 这个功能会影响哪些相关部分？
- 是否需要同步修改其他文件？
- 是否符合项目现有模式？

#### ⚠️ 水合风险评估

- SSR环境下是否存在水合风险？
- 是否依赖浏览器API（window, localStorage等）？
- 如何防范？使用`useIsClient`还是动态导入？

#### 🛡️ 类型安全分析

- 所有类型是否已有定义？
- 是否需要新增interface？
- 是否存在可选依赖需要类型声明？

#### 🔄 重复代码检查

- 这个逻辑在其他地方存在吗？
- 能否抽取公共函数？
- 是否符合DRY原则？

#### ⏱️ 时序预判

- 如果有两个请求同时到达会发生什么？
- 异步操作是否有竞态条件风险？
- 是否需要添加防护机制？

### 3. 全局搜索要求

在实现前，请先搜索全文：

- 查看`packages/shared/src/types`中是否有可复用结构
- 查看其他页面是如何处理类似功能的，保持一致性
- 检查是否存在类似问题的已有解决方案
- 搜索是否有可复用的工具函数或Hooks

### 4. 上下文背景

- **相关文件**：`src/components/X.tsx`, `src/hooks/useY.ts`
- **技术栈**：Next.js 15, React Query, Tailwind CSS, 国际化路由
- **特殊约束**：国际化路由 `/[locale]/path`，共享QueryClient，遵循DRY原则

### 5. 功能需求

- **用户故事**：作为[用户角色]，我想要[做什么]，以便[达到什么目的]
- **验收标准**：
  - [ ] 功能A正常工作
  - [ ] 功能B边界情况处理
  - [ ] 响应式适配完成
  - [ ] 多语言支持

### 6. 核心要求（请AI重点关注）

1. **DRY检查**：检查是否有重复逻辑可以抽取公共函数
2. **一致性检查**：确保相关组件逻辑统一
3. **边界情况**：处理语言前缀、空状态、错误回退
4. **时序预判**：异步操作考虑竞态条件

### 7. 技术约束

- 必须使用现有的 `@repo/ui` 组件库
- 必须遵循项目代码风格和架构模式
- 必须兼容国际化路由格式
- 必须考虑移动端适配

---

## 🔧 模板B：问题修复

### 1. 角色定位与架构背景

- **角色定位**：你现在是**全栈架构师**，负责修复JoyMini项目的[具体问题]。请从系统角度思考，不要只盯着几行代码。
- **架构背景**：
  - 项目类型：Next.js 15 + NestJS + PostgreSQL全栈应用
  - 水合要求：**绝对不允许产生Hydration Error**
  - 类型安全：**严格模式，禁止any**

### 2. 思考过程要求（必须先完成）

在写代码前，你必须输出：

#### 🔍 根因分析（不是表面现象）

- 问题的根本原因是什么？
- 是架构设计问题还是实现细节问题？
- 为什么之前的设计会导致这个问题？

#### ⚠️ 水合风险评估

- 这个问题是否与水合相关？
- 修复方案是否会引入新的水合风险？
- 如何确保修复后不会产生水合错误？

#### 🛡️ 类型安全分析

- 问题是否与类型定义有关？
- 修复方案是否类型安全？
- 是否需要新增或修改类型定义？

#### 🔄 系统影响分析

- 这个修复会影响哪些相关部分？
- 是否需要同步修改其他文件？
- 修复方案是否符合项目现有模式？

### 3. 全局搜索要求

在修复前，请先搜索全文：

- 查看是否有类似的修复案例
- 搜索相关错误信息，了解常见解决方案
- 检查是否有可复用的修复模式

### 4. 问题现象

- **具体表现**：[描述用户看到的问题现象]
- **复现步骤**：
  1. 访问 `/zh/categories`
  2. 点击某个分类
  3. 观察到[问题现象]

### 5. 预期行为

- **正常情况**：[描述应该看到什么]
- **当前情况**：[描述实际看到什么]

### 6. 已排查信息

- **相关文件**：`src/components/X.tsx` (第42行)
- **错误信息**：`Error: Cannot read property 'xxx' of undefined`
- **环境信息**：Chrome 浏览器，中文语言环境

### 7. 修复要求

1. **根因分析**：请先分析问题根本原因，不要直接贴代码
2. **影响范围**：评估这个修复会影响哪些其他功能
3. **测试方案**：如何验证修复成功
4. **预防措施**：如何避免类似问题再次发生

### 8. 🔄 闭环改进要求 (必须完成)

修复完成后，你必须执行以下步骤：

- [ ] **根因归档**：这个问题的根本原因是什么？
- [ ] **影响范围**：还有哪些地方存在同样的问题？
- [ ] **预防措施**：如何保证这个问题永远不会再发生？
- [ ] **知识更新**：是否需要更新架构文档、规则或注释？
- [ ] **模式提炼**：如果这是重复出现的问题，是否需要提炼为通用规则？

> ❗ 重要提示：没有完成闭环的修复是不合格的修复。仅仅让错误消失只完成了20%的工作。

---

## 🏗️ 模板C：代码重构

### 1. 角色定位与架构背景

- **角色定位**：你现在是**全栈架构师**，负责重构JoyMini项目的[具体模块]。请从系统角度思考，优化整体架构。
- **架构背景**：
  - 项目类型：Next.js 15 + NestJS + PostgreSQL全栈应用
  - 重构目标：提升代码质量，消除技术债务

### 2. 思考过程要求（必须先完成）

在写代码前，你必须输出：

#### 🔍 现状分析

- 当前代码的主要问题是什么？
- 这些问题对系统有什么影响？
- 重构的优先级如何确定？

#### 🛡️ 类型安全分析

- 当前代码的类型安全性如何？
- 重构后如何提升类型安全性？
- 是否需要新增或修改类型定义？

#### 🔄 重复代码分析

- 哪些代码存在重复？
- 如何抽取公共函数或组件？
- 抽取后的接口设计如何？

#### ⏱️ 性能影响分析

- 重构对性能有什么影响？
- 如何确保重构后性能不下降？
- 是否需要添加性能测试？

### 3. 全局搜索要求

在重构前，请先搜索全文：

- 查看是否有可复用的公共函数或组件
- 搜索类似的重构案例
- 检查是否有相关的类型定义

### 4. 重构目标

- **当前问题**：代码重复、维护困难、性能问题、类型不安全
- **重构范围**：`src/components/` 目录下的相关文件
- **不变量**：必须保持现有功能完全不变

### 5. 重构原则

1. **DRY优先**：抽取重复逻辑为公共函数
2. **单一职责**：每个函数/组件只做一件事
3. **类型安全**：消除any类型，完善TypeScript定义
4. **性能优化**：减少不必要的重渲染

### 6. 具体任务

- [ ] 分析现有代码的重复模式
- [ ] 设计公共函数/组件接口
- [ ] 逐步替换，保持功能不变
- [ ] 添加单元测试

### 7. 验收标准

- [ ] 代码行数减少 X%
- [ ] 类型覆盖率提升到 100%
- [ ] 编译通过，测试通过
- [ ] 性能指标无下降

---

## 📚 模板D：文档编写

### 1. 角色定位与架构背景

- **角色定位**：你现在是**技术文档架构师**，负责编写JoyMini项目的技术文档。
- **架构背景**：
  - 项目类型：Next.js 15 + NestJS + PostgreSQL全栈应用
  - 文档标准：必须遵循七层黄金文档结构

### 2. 思考过程要求（必须先完成）

在写文档前，你必须输出：

#### 🔍 读者分析

- 文档的目标读者是谁？
- 读者的技术背景如何？
- 读者最关心什么信息？

#### 🎯 内容规划

- 文档的核心价值是什么？
- 需要包含哪些关键信息？
- 如何组织内容结构？

#### 📊 实用性分析

- 文档是否包含可执行的命令？
- 是否有具体的代码示例？
- 是否包含部署和故障排查指南？

### 3. 文档目的

- **目标读者**：[开发者/产品经理/测试人员]
- **使用场景**：[开发参考/部署指南/故障排查]
- **预期效果**：读者能够[完成什么任务]

### 4. 内容结构（七层黄金文档结构）

1. **📋 问题描述**：我们遇到了什么问题
2. **🎯 根因分析**：根本原因是什么
3. **✅ 方案选型**：有哪些方案，为什么选择这个
4. **🏗️ 系统架构**：整体设计是什么样的
5. **🔄 工作流程**：数据是怎么流动的
6. **⚙️ 实现细节**：关键实现点和边界条件
7. **📊 成本性能**：生产环境运行指标

### 5. 写作要求

- 使用中文，技术术语保持英文
- 包含代码示例和图表
- 提供实际可执行的命令
- 注明相关文件和版本信息

---

## 🧩 模板E：类型修复与架构优化

> **适用场景**：TypeScript类型错误、Zustand类型推导问题、复杂泛型不匹配、中间件类型包装错误、可选依赖类型问题

### 1. 角色定位与架构背景

- **角色定位**：你现在是**类型安全架构师**，负责修复JoyMini项目的类型安全问题。
- **架构背景**：
  - 项目类型：Next.js 15 + NestJS + PostgreSQL全栈应用
  - 类型要求：**严格模式，禁止any**

### 2. 思考过程要求（必须先完成）

在修复前，你必须输出：

#### 🔍 错误分析

- 错误的根本原因是什么？
- 是接口不匹配还是类型推导错误？
- 为什么TypeScript会报这个错误？

#### 🛡️ 类型推导路径分析

- 编译器如何推导类型？
- 初始值是什么类型？
- 中间件如何包装类型？

#### 🔄 可选依赖分析

- 是否有可选模块导致类型错误？
- 是否需要创建类型声明文件？
- 如何处理动态导入的类型安全？

### 3. 全局搜索要求

在修复前，请先搜索全文：

- 查看`packages/shared/src/types`中是否有可复用类型
- 搜索类似的类型错误修复案例
- 检查是否有相关的类型定义文件

### 4. 问题描述

- **错误信息**：复制完整的TypeScript错误信息（包括错误代码和位置）
- **相关文件**：列出所有涉及的文件路径和行号
- **环境信息**：
  - TypeScript版本：`tsc --version`
  - 相关库版本：zustand、react、next.js等
  - 配置选项：tsconfig.json中的严格模式设置

### 5. 类型系统分析

- **接口定义**：当前接口如何定义？复制相关interface/type定义
- **实现方式**：实际代码如何实现？与接口定义有何差异？
- **类型推导路径**：编译器如何推导类型？初始值是什么类型？
- **中间件影响**：persist、devtools等中间件如何包装类型？
- **可选依赖**：是否有可选模块导致类型错误？

### 6. 修复原则（避免"懒惰"类型推导）

1. **绝对避免`any`**：使用`unknown`或精确类型，绝不使用`any`
2. **接口一致性**：确保接口定义与实际实现完全匹配
3. **类型标注明确**：对复杂初始值使用类型断言`as Type`
4. **工具类型利用**：使用库提供的工具类型（如Zustand的`StateCreator`）
5. **可选依赖处理**：为可选模块创建类型声明文件

### 7. 常见模式与最佳实践

#### 🛠️ Zustand Store类型定义规范

```typescript
// ✅ 正确：明确定义初始状态类型
interface AuthState {
  user: User | null;
  accessToken: string | null;
  // ...
}

const initialState: AuthState = {
  user: null,
  accessToken: null,
  // ...
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      ...initialState,
      // actions
      login: (tokens, user) => {
        set({ ...tokens, user });
      },
      // 计算属性
      get isAuthenticated() {
        return !!(get().accessToken && get().user);
      },
    }),
    { name: "auth-storage" },
  ),
);

// ❌ 错误：依赖类型推导（"懒惰"模式）
export const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null, // TypeScript推导为null，而不是User | null
      accessToken: null, // 推导为null，而不是string | null
      // 类型推导混乱，容易出错
    }),
    { name: "auth-storage" },
  ),
);
```

#### 🔄 方法vs计算属性选择指南

```typescript
// 场景1：需要缓存结果、无参数 → 使用计算属性
interface State {
  get fullName(): string; // 计算属性
  get isAuthenticated(): boolean;
}

// 场景2：需要参数、复杂逻辑、副作用 → 使用方法
interface State {
  hasPermission(permission: string): boolean; // 方法
  validateToken(token: string): boolean;
}

// 场景3：Zustand中的特殊处理
// 如果计算属性在Zustand中导致类型问题，改为方法
interface State {
  isAuthenticated: () => boolean; // 改为方法
}
```

#### 🧪 类型验证方案

1. **严格类型检查**：

   ```bash
   npx tsc --noEmit --strict --skipLibCheck
   ```

2. **边界测试**：
   - 测试null/undefined状态
   - 测试中间件hydration过程
   - 测试类型转换边界

3. **工具验证**：
   - 使用TypeScript Playground验证复杂类型
   - 使用VSCode的TypeScript检查功能

#### 📦 可选依赖类型处理指南

```typescript
// ✅ 正确：为可选依赖创建类型声明文件
// 文件：src/types/capacitor.d.ts
declare module "@capacitor/preferences" {
  export interface GetOptions {
    key: string;
  }

  export interface GetResult {
    value: string | null;
  }

  export interface PreferencesPlugin {
    get(options: GetOptions): Promise<GetResult>;
    set(options: { key: string; value: string }): Promise<void>;
    remove(options: { key: string }): Promise<void>;
  }

  export const Preferences: PreferencesPlugin;
}

// ✅ 正确：代码中的动态导入和fallback机制
if (isCapacitor) {
  return {
    getItem: async (key: string): Promise<string | null> => {
      try {
        const { Preferences } = await import("@capacitor/preferences");
        const { value } = await Preferences.get({ key });
        return value;
      } catch (error) {
        console.warn(
          "Capacitor Preferences not available, falling back to localStorage:",
          error,
        );
        return localStorage.getItem(key);
      }
    },
    // ...
  };
}

// ❌ 错误：忽略可选依赖的类型检查
// 会导致 TS2307: Cannot find module '@capacitor/preferences'
```

#### 🔧 动态导入类型安全模式

```typescript
// 模式1：条件导入 + 类型声明
type OptionalModule = typeof import("@capacitor/preferences");

const loadOptionalModule = async (): Promise<OptionalModule | null> => {
  try {
    return await import("@capacitor/preferences");
  } catch {
    return null;
  }
};

// 模式2：类型安全的fallback
interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const createStorageAdapter = (): StorageAdapter => {
  if (isCapacitor) {
    return {
      getItem: async (key) => {
        try {
          const { Preferences } = await import("@capacitor/preferences");
          const { value } = await Preferences.get({ key });
          return value;
        } catch {
          return localStorage.getItem(key);
        }
      },
      // ...
    };
  }
  // ...
};
```

### 8. 修复步骤检查清单

- [ ] **分析错误根源**：是接口不匹配？还是类型推导错误？
- [ ] **检查初始值类型**：初始值是否与接口定义一致？
- [ ] **验证中间件包装**：persist等中间件是否正确处理类型？
- [ ] **测试边界情况**：null、undefined、空状态是否正确处理？
- [ ] **运行严格检查**：通过所有TypeScript严格模式检查
