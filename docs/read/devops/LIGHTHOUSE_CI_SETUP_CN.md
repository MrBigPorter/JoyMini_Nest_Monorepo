# Lighthouse CI 部署指南

> 完成时间：5 分钟｜用途：自动审计页面性能指标

## 🔴 当前状态

- ✅ 工作流代码已配置（`.github/workflows/lighthouse-ci.yml`）
- ✅ 性能阈值已定义（`apps/admin-next/lighthouserc.js`）
- ❌ **GitHub Secrets 缺失** → Lighthouse CI 无法启动认证，工作流失败

## 🎯 需要什么

Lighthouse CI 需要登录后端 API 才能访问后台管理页面。在 GitHub 设置以下两个 Secrets：

| Secret                      | 值                       | 用途                                            |
| --------------------------- | ------------------------ | ----------------------------------------------- |
| `LIGHTHOUSE_ADMIN_USERNAME` | 超管账号用户名（见下表） | 登录 `api.joyminis.com/api/v1/auth/admin/login` |
| `LIGHTHOUSE_ADMIN_PASSWORD` | 超管账号密码（见下表）   | 同上                                            |

---

## 🔑 创建/获取超管账号

### 方式 1：用现有超管账号（推荐）

从团队获取已有超管的用户名 + 密码。

### 方式 2：自己创建超管账号（需 VPS 访问权限）

```bash
# 在 VPS 上运行（需要 SSH 权限）
ssh ubuntu@api.joyminis.com -p 22
cd /opt/lucky
docker exec lucky-backend-prod yarn workspace @lucky/api cli:create-admin
```

**交互式输入**：

```
? Username (email or phone): admin-lhci
? Password: [输入强密码，建议 >= 16 字符]
? Confirm password: [重复输入]
✓ Admin user created successfully
```

记下用户名 + 密码，待会儿用。

---

## 🔧 步骤 1：登录 GitHub 仓库

1. 打开 https://github.com/mrbigporter/lucky-nest-monorepo
2. 点击 **Settings** → **Environments** → 选择 **production**

---

## 🔧 步骤 2：添加 Secret `LIGHTHOUSE_ADMIN_USERNAME`

1. 在 **production** 环境页面，点 **Add environment secret**
2. 填入：
   - **Name**: `LIGHTHOUSE_ADMIN_USERNAME`
   - **Value**: 超管的用户名（例如 `admin-lhci`）
3. 点 **Add secret**

---

## 🔧 步骤 3：添加 Secret `LIGHTHOUSE_ADMIN_PASSWORD`

重复步骤 2，但改成：

- **Name**: `LIGHTHOUSE_ADMIN_PASSWORD`
- **Value**: 超管的密码

---

## ✅ 验证配置

### 方式 A：等待自动触发（10 分钟）

只要后端部署成功（`Deploy Backend` 或 `Deploy Admin (Cloudflare)` 完成），Lighthouse CI 就会自动触发。

### 方式 B：手动触发（立即验证）

1. 打开 https://github.com/mrbigporter/lucky-nest-monorepo/actions
2. 左边点 **Lighthouse CI**
3. 右边点 **Run workflow** → 选择 **main** 分支 → 点 **Run workflow**
4. 等待 2~3 分钟，看工作流是否通过

---

## 📊 工作流触发条件

| 条件         | 说明                                           |
| ------------ | ---------------------------------------------- |
| **自动触发** | `Deploy Admin (Cloudflare)` 部署到 main 成功后 |
| **手动触发** | Actions 页面 → Lighthouse CI → Run workflow    |

---

## 📈 查看报告

### 生成后立即查看

工作流完成后，会在 **Actions → Lighthouse CI → [run number] → Summary** 展示一个 Markdown 表格：

```
| Page | LCP (ms) | TBT (ms) | CLS | Score |
|------|---------|---------|-----|-------|
| ✅ /login | 1234 | 45 | 0.05 | 92 |
| ✅ / | 1567 | 67 | 0.08 | 88 |
| ...
```

### 下载完整报告

工作流完成后：

1. 点 **Artifacts** → **lighthouse-reports-[number]**
2. 下载 `.lighthouseci/` 文件夹
3. 用浏览器打开 `lhr-*.html` 查看详细审计结果

---

## 🚨 常见问题

### Q：工作流失败了，Error: `Login failed with HTTP 401`

**原因**：用户名或密码错误。

**解决**：

1. 确认超管账号能正常登录 https://admin.joyminis.com
2. 重新检查 Secrets 里的用户名和密码（无空格、无引号）
3. 如果仍然失败，删除旧 Secret 后重新添加

### Q：工作流卡在 `Get auth token from production API`

**原因**：`api.joyminis.com` 无法访问（网络问题或后端宕机）。

**解决**：

1. 手动测试：`curl -X POST https://api.joyminis.com/api/v1/auth/admin/login -H "Content-Type: application/json" -d '{"username":"admin-lhci","password":"xxx"}'`
2. 如果连接超时，检查后端服务状态（VPS 上 `docker ps | grep backend`）
3. 等待后端恢复后重新运行

### Q：工作流成功但报告数据都很高（LCP > 5000ms）

**原因**：Lighthouse 跑分时网络差或服务器负载高。

**解决**：

- 本地重新跑 1 次看结果是否稳定
- 如果是稳定高，则需要优化页面性能（见 `read/performance/PERFORMANCE_LIGHTHOUSE_CN.md`）

### Q：工作流没有自动触发？

**原因**：

1. 你的提交没有到达 `main` 分支（还在 PR 或本地）
2. 提交没有改到 `apps/admin-next/` 等关键路径
3. 部署工作流本身失败了

**解决**：

- 改个文件推送到 main，或手动触发

---

## 📋 衡量标准（Google Core Web Vitals）

| 指标                | 目标             | 状态     |
| ------------------- | ---------------- | -------- |
| LCP（最大内容绘制） | < 2500ms（内网） | 目前待测 |
| FCP（首次内容绘制） | < 1000ms         | 目前待测 |
| TBT（总阻塞时间）   | < 200ms          | 目前待测 |
| CLS（布局偏移）     | < 0.1            | 目前待测 |

---

## 🔗 相关文件

- 工作流定义：`.github/workflows/lighthouse-ci.yml`
- 审计配置：`apps/admin-next/lighthouserc.js`
- 性能文档：`read/performance/PERFORMANCE_LIGHTHOUSE_CN.md`
- Sentry 文档：`read/devops/LHCI_SENTRY_SETUP_CN.md`

---

## 📞 需要帮助？

如果配置卡住了，检查：

1. ✅ `LIGHTHOUSE_ADMIN_USERNAME` 和 `LIGHTHOUSE_ADMIN_PASSWORD` 已添加到 GitHub **production** 环境
2. ✅ 后端 `api.joyminis.com` 能正常访问
3. ✅ 超管账号能在 https://admin.joyminis.com 正常登录
4. ✅ 部署工作流已成功完成

搞定这四项后，Lighthouse CI 会自动启动。
