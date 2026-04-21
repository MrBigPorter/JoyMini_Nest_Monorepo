# 🚀 开发工作流程优化指南

基于 `.clinerules` 第13条禁令："禁止不必要的 dev 重启"，制定本优化指南。

## 📋 核心原则

**90%的代码修改无需重启 dev 服务器！**

## 🔍 修改类型识别

### ✅ **无需重启的情况**

- React 组件修改（.tsx/.jsx 文件）
- CSS/Tailwind 样式修改
- TypeScript 类型定义修改
- 工具函数修改（src/lib/utils/）
- 自定义 Hook 修改（src/lib/hooks/）
- 页面布局修改
- API 调用逻辑修改（不涉及环境变量）

### ⚠️ **需要重启的情况**

- 修改 `next.config.ts` / `next.config.js`
- 修改 `tailwind.config.ts` / `tailwind.config.js`
- 修改环境变量（.env.\* 文件）
- 安装/更新 npm 包依赖（package.json）
- 修改 Docker 配置
- 修改 middleware.ts / i18n.config.ts

## 🛠️ **正确的命令使用**

### ❌ **禁止使用的命令**

```bash
yarn dev          # 会启动所有应用，导致系统卡顿
```

### ✅ **推荐使用的命令**

#### 1. **启动特定前端**

```bash
# 只启动 admin-next
yarn workspace @lucky/admin-next dev

# 或者使用 Makefile
make dev-next

# 只启动 frontend-blog
yarn workspace @lucky/frontend-blog dev
```

#### 2. **验证命令（替代重启）**

```bash
# 类型检查
yarn type-check

# 代码规范检查
yarn lint

# 格式检查
yarn prettier --check

# 只检查特定工作区
yarn workspace @lucky/admin-next check-types
yarn workspace @lucky/admin-next lint
```

#### 3. **基础设施管理**

```bash
# 启动基础设施（DB + Redis + API + Nginx）
make up-infra

# 查看日志
make logs

# 停止所有服务
make down
```

## 📝 **AI 工作流程检查清单**

在每次代码修改后，AI 必须自问：

### 1. **是否需要重启？**

- [ ] 是否修改了配置文件？（next.config.ts, tailwind.config.ts）
- [ ] 是否修改了环境变量？
- [ ] 是否更新了包依赖？
- [ ] 是否修改了 Docker 配置？

### 2. **如何验证修改？**

- [ ] 使用 `yarn type-check` 进行类型检查
- [ ] 使用 `yarn lint` 进行代码规范检查
- [ ] 使用 `yarn prettier --check` 进行格式检查

### 3. **如何启动服务？**

- [ ] 使用工作区特定命令：`yarn workspace @lucky/admin-next dev`
- [ ] 使用 Makefile：`make dev-next`
- [ ] 避免使用全局 `yarn dev`

## 🚨 **常见错误模式及修正**

### 错误模式 1：验证时重启服务

```bash
# ❌ 错误
yarn dev  # 重启所有服务进行验证

# ✅ 正确
yarn type-check && yarn lint  # 只进行验证，不重启
```

### 错误模式 2：启动错误的工作区

```bash
# ❌ 错误
yarn dev  # 启动所有应用

# ✅ 正确
yarn workspace @lucky/admin-next dev  # 只启动需要的应用
```

### 错误模式 3：基础设施重复启动

```bash
# ❌ 错误
make up  # 启动全套环境（包括前端容器）

# ✅ 正确
make up-infra  # 只启动基础设施
make dev-next  # 在本机运行前端（热重载更快）
```

## 📊 **性能影响对比**

| 操作                                   | 内存占用      | 启动时间      | CPU 使用 | 推荐度      |
| -------------------------------------- | ------------- | ------------- | -------- | ----------- |
| `yarn dev`                             | 高 (3+ 进程)  | 慢 (30+ 秒)   | 高       | ❌ 不推荐   |
| `yarn workspace @lucky/admin-next dev` | 中 (1 进程)   | 中 (10-15 秒) | 中       | ✅ 推荐     |
| `make dev-next`                        | 低 (复用现有) | 快 (5-10 秒)  | 低       | ✅ 强烈推荐 |
| 验证命令 (`type-check`, `lint`)        | 很低          | 很快 (2-5 秒) | 很低     | ✅ 必须使用 |

## 🔄 **热重载利用指南**

### Next.js 热重载特性

- **组件修改**：自动热更新，无需重启
- **样式修改**：Tailwind 自动编译，无需重启
- **路由修改**：自动检测，无需重启
- **API 路由修改**：自动重启 API 路由，无需重启整个服务

### 最大化热重载效率

1. **保持 dev 服务器运行**：不要频繁重启
2. **使用工作区特定命令**：减少进程数量
3. **分离基础设施**：使用 Docker 运行后端，本机运行前端
4. **利用验证命令**：用 `type-check` 和 `lint` 替代重启

## 📈 **预期效果**

实施此优化后：

- **开发效率提升 50%+**：减少不必要的等待时间
- **系统资源占用降低 70%+**：减少并行进程数量
- **热重载速度提升 3x**：更快的代码反馈循环
- **错误率降低**：减少因重启导致的配置错误

---

**记住**：你不是在重启服务，你是在编写代码。让工具为你工作，而不是你为工具工作。
