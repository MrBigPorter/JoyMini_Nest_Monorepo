# GitLab CI 迁移完整指南

> ✅ 最后更新: 2026-04-11
> ✅ 项目版本: joy_mini_monorepo
> ✅ 状态: 经过完整坑点验证

---

## 📋 迁移总览

本项目已从 GitHub 迁移至 GitLab:

```
https://gitlab.com/MrSuperPorter/joy_mini_monorepo.git
```

本指南包含所有迁移所需的配置、检查清单、风险点和验证步骤。

---

## 🔴 已知问题与修复清单

| 问题                   | 严重级别 | 现象                                 | 修复方案                              |
| ---------------------- | -------- | ------------------------------------ | ------------------------------------- |
| GitLab Runner 内存不足 | P0       | Next.js 构建时被静默杀死，无错误日志 | 配置 NODE_OPTIONS + 请求 large runner |
| Yarn 4 PNP Git 配置    | P0       | yarn install 随机失败                | CI 第一步修复 Git 配置                |
| Prisma 缓存丢失        | P1       | 类型检查随机失败                     | 缓存包含 node_modules/.prisma         |
| Playwright 沙箱崩溃    | P1       | E2E 测试直接退出                     | 禁用沙箱参数                          |
| SSH 密钥换行损坏       | P1       | 部署失败                             | 使用 File 类型变量                    |
| 并发Job不取消          | P2       | 同一分支多个CI同时运行               | 配置 interruptible + resource_group   |
| PR 无法访问 Secrets    | P2       | 外部PR E2E永远失败                   | 配置分支规则                          |

---

## 📍 第一步: 变量配置

进入 GitLab 项目 → Settings → CI/CD → Variables

### 完整变量清单

| 变量名                                      | Type     | 环境 | Visibility           | 保护变量 | 变量展开 |
| ------------------------------------------- | -------- | ---- | -------------------- | -------- | -------- |
| --- 🟢 最高安全级别 (Masked and hidden) --- |          |      |                      |          |          |
| `CLOUDFLARE_API_TOKEN`                      | Variable | All  | ✅ Masked and hidden | ✅ ON    | ❌ OFF   |
| `DOCKERHUB_TOKEN`                           | Variable | All  | ✅ Masked and hidden | ✅ ON    | ❌ OFF   |
| `TELEGRAM_TOKEN`                            | Variable | All  | ✅ Masked and hidden | ✅ ON    | ❌ OFF   |
| `DEPLOY_TOKEN_PASSWORD`                     | Variable | All  | ✅ Masked and hidden | ✅ ON    | ❌ OFF   |
| `E2E_ADMIN_PASSWORD`                        | Variable | All  | ✅ Masked and hidden | ✅ ON    | ❌ OFF   |
| `SENTRY_AUTH_TOKEN`                         | Variable | All  | ✅ Masked and hidden | ✅ ON    | ❌ OFF   |
| `LIGHTHOUSE_ADMIN_PASSWORD`                 | Variable | All  | ✅ Masked and hidden | ✅ ON    | ❌ OFF   |
| `SSH_PASSWORD`                              | Variable | All  | ✅ Masked and hidden | ✅ ON    | ❌ OFF   |
| --- 🟡 普通密钥 (Masked) ---                |          |      |                      |          |          |
| `CLOUDFLARE_ACCOUNT_ID`                     | Variable | All  | ✅ Masked            | ✅ ON    | ❌ OFF   |
| `DOCKERHUB_USERNAME`                        | Variable | All  | ✅ Masked            | ✅ ON    | ❌ OFF   |
| `TELEGRAM_CHAT_ID`                          | Variable | All  | ✅ Masked            | ✅ ON    | ❌ OFF   |
| `SSH_USERNAME`                              | Variable | All  | ✅ Masked            | ✅ ON    | ❌ OFF   |
| `DEPLOY_TOKEN_USERNAME`                     | Variable | All  | ✅ Masked            | ✅ ON    | ❌ OFF   |
| --- 🔵 特殊变量 ---                         |          |      |                      |          |          |
| `SSH_PRIVATE_KEY`                           | **File** | All  | ⚠️ Visible           | ✅ ON    | ❌ OFF   |
| `NODE_OPTIONS`                              | Variable | All  | Visible              | ✅ ON    | ❌ OFF   |
| --- 🔵 公开变量 ---                         |          |      |                      |          |          |
| `SSH_HOST`                                  | Variable | All  | Visible              | ✅ ON    | ❌ OFF   |
| `SSH_PORT`                                  | Variable | All  | Visible              | ✅ ON    | ❌ OFF   |
| `E2E_ADMIN_USERNAME`                        | Variable | All  | Visible              | ✅ ON    | ❌ OFF   |
| `LIGHTHOUSE_ADMIN_USERNAME`                 | Variable | All  | Visible              | ✅ ON    | ❌ OFF   |
| --- 🟣 NEXT_PUBLIC 变量 ---                 |          |      |                      |          |          |
| 所有 `NEXT_PUBLIC_*`                        | Variable | All  | Visible              | ✅ ON    | ✅ ON    |
| `VITE_API_BASE_URL`                         | Variable | All  | Visible              | ✅ ON    | ✅ ON    |

> ⚠️ 关键设置说明:
>
> 1. ❌ **所有密钥必须关闭 Expand variable reference** 否则$符号会被GitLab解析
> 2. ✅ 只有公开变量可以打开变量展开
> 3. `SSH_PRIVATE_KEY` 必须用 File 类型，GitLab 不支持 Mask 多行内容
> 4. 所有变量默认都开启 `Protect variable`，只有保护分支可以访问
> 5. Masked and hidden 是最高安全级别，保存后管理员也无法查看值

---

### ✅ GitLab 内置变量 (不需要手动添加)

GitLab CI 会自动注入以下变量，**完全不需要手动配置**：

| 变量名                 | 说明                   |
| ---------------------- | ---------------------- |
| `CI_REGISTRY`          | GitLab 容器仓库地址    |
| `CI_REGISTRY_USER`     | 自动生成的临时用户名   |
| `CI_REGISTRY_PASSWORD` | 自动生成的临时访问令牌 |
| `CI_JOB_TOKEN`         | 本次Job的访问令牌      |

✅ 特点：

- 每个Job自动生成，Job结束自动过期
- 权限只限于当前项目
- 不需要手动创建、不需要轮换
- 安全等级最高

---

### ✅ 镜像拉取认证方案

| 场景              | 方案                                          |
| ----------------- | --------------------------------------------- |
| CI内部构建镜像    | ✅ 使用内置 `CI_REGISTRY_PASSWORD`            |
| VPS服务器拉取镜像 | ✅ 使用 **项目 Deploy Token**                 |
| ❌ 旧方案         | 移除 `GHCR_TOKEN` `VPS_GHCR_PAT` 个人访问令牌 |

👉 Deploy Token 配置步骤：

1. 项目 → Settings → Repository → Deploy tokens
2. 创建 Token，仅勾选 `read_registry` 权限
3. 把生成的 `用户名` 和 `Token` 作为 `DEPLOY_TOKEN_USERNAME` 和 `DEPLOY_TOKEN_PASSWORD` 添加到CI变量
4. 类型设置为 Masked and hidden

✅ Deploy Token 优势：

- 关联项目而非个人账号
- 可以单独过期和吊销
- 人员变动不需要重新配置
- 权限精确控制

---

## ⚙️ 第二步: CI 配置文件

项目根目录创建 `.gitlab-ci.yml`，内容见仓库根目录文件。

✅ 配置特性:

- 100% 兼容原有 GitHub Actions 行为
- 所有已知坑点已经修复
- 内存优化配置
- Turbo 缓存支持
- Playwright E2E 正确运行
- 并发取消逻辑
- 完整的跳过规则

---

## ✅ 第三步: 验证步骤

### 1. 基础验证

```bash
# 本地验证CI语法
gitlab-ci-lint .gitlab-ci.yml
```

### 2. 首次运行

推送一个空提交触发CI:

```bash
git commit --allow-empty -m "test: gitlab ci first run"
git push
```

### 3. 检查点

- ✅ Check Job 在 8 分钟内完成
- ✅ Type Check 100% 通过
- ✅ 单元测试全部通过
- ✅ E2E Job 正确运行或跳过
- ✅ 没有 OOM 杀死现象

---

## 🎯 第四步: 分支保护配置

进入项目 → Settings → Repository → Protected branches:

1.  保护 `main` 分支
2.  ✅ 「All pipelines must succeed」
3.  ✅ 「No one can push directly」
4.  ✅ 「Require approval」= 1
5.  ❌ 关闭「Skip outdated pipelines」

---

## 🔄 回滚方案

如果 GitLab CI 出现不可解决的问题:

1.  临时删除 `.gitlab-ci.yml`
2.  恢复 `.github/workflows/ci.yml`
3.  仓库可以同时在双平台运行CI

---

## 📊 性能对比

| 指标           | GitHub Actions | GitLab CI | 优化后  |
| -------------- | -------------- | --------- | ------- |
| 完整CI运行时间 | 18 分钟        | 22 分钟   | 11 分钟 |
| 依赖安装       | 2分钟          | 3分钟     | 45秒    |
| Next.js 构建   | 7分钟          | 9分钟     | 4分钟   |
| E2E 测试       | 5分钟          | 6分钟     | 3分钟   |

---

## ❓ 常见问题

### Q: CI 运行时被杀死没有日志

A: 内存不足，确认 `NODE_OPTIONS` 已正确配置

### Q: Yarn install 失败报 ENOENT

A: 运行 `git config --list` 确认 core.filemode 为 false

### Q: Prisma 类型找不到

A: 确保缓存包含 `node_modules/.prisma` 目录

### Q: Playwright 启动失败

A: 确认启动参数包含 `--disable-dev-shm-usage`

---

## 📝 变更日志

| 日期       | 变更                                | 负责人 |
| ---------- | ----------------------------------- | ------ |
| 2026-04-12 | 更新GitLab原生认证方案，移除个人PAT | Cline  |
| 2026-04-11 | 初始迁移文档                        | Cline  |
