# Lucky Nest 部署操作手册

> **📖 只写你每天会用到的操作，5 分钟上手。**

---

## 一、我该怎么部署？

### ✅ 方式 1：推送代码到 GitHub（推荐）

你只需要 `git push`，剩下的事情 CI 自动完成：

```bash
git add .
git commit -m "改了什么"
git push
```

GitHub Actions 会自动：
1. 检查代码 → 2. 构建镜像 → 3. 推送到 GHCR → 4. SSH 到 VPS → 5. 拉取镜像 → 6. 重启后端 → 7. 健康检查

> ⚠️ **注意**：只有改了 `apps/api/**` 或 `packages/shared/**` 等后端文件才会触发部署。改前端不会触发后端 CI。

### ✅ 方式 2：本地手动部署（网络慢时备用）

```bash
# 只部署后端（最常用）
VPS_IP=<YOUR_SERVER_IP> ./deploy/deploy.sh --backend

# 部署全部（后端 + 前端）
VPS_IP=<YOUR_SERVER_IP> ./deploy/deploy.sh
```

> 本地部署流程：本地构建 Docker 镜像 → 压缩 → SCP 传到 VPS → VPS 加载镜像 → 重启容器。

---

## 二、怎么看部署成没成功？

### 看 CI 状态

去 GitHub → 你的仓库 → `Actions` 标签 → 最新的 `Deploy Backend` 工作流：

| 图标 | 含义 |
|------|------|
| ✅ 绿色 | 部署成功 |
| ❌ 红色 | 部署失败 → 点进去看哪个步骤红了 |

### 直接测接口

```bash
# 测后端是否活着
curl https://api.<YOUR_DOMAIN>.com/api/v1/health

# 正常返回：{"code":10000,"message":"success","data":{"ok":true}}
```

### SSH 进 VPS 看

```bash
# 登录 VPS
ssh <YOUR_USER>@<YOUR_SERVER_IP>

# 看所有容器状态
docker ps -a

# 看后端日志（最近 50 行）
docker logs --tail=50 lucky-backend-prod
```

---

## 三、出问题了怎么办？

### ❌ 接口返回 404

```bash
# 1. 先确认后端是否在跑
ssh <YOUR_USER>@<YOUR_SERVER_IP> 'docker ps | grep lucky-backend'

# 2. 如果不在跑，重启后端
ssh <YOUR_USER>@<YOUR_SERVER_IP> 'cd /opt/lucky && docker compose -f compose.prod.yml restart backend'

# 3. 如果在跑还是 404，可能跑的是旧代码 → 手动重启
ssh <YOUR_USER>@<YOUR_SERVER_IP> 'cd /opt/lucky && BACKEND_IMAGE=lucky-backend-prod:latest docker compose -f compose.prod.yml up -d --no-deps --force-recreate backend'
```

### ❌ CI 显示红色

1. 点进 GitHub Actions 看哪个步骤红了
2. 常见原因：
   - **Nginx 配置错误**：VPS 上 `/etc/nginx/conf.d/` 有语法问题，找运维修
   - **代码检查失败**：本地跑 `yarn workspace @lucky/api lint` 看报什么错
   - **SSH 连不上 VPS**：网络问题，等几分钟重试

### ❌ 本地 `deploy.sh` 卡住了

网络慢，SCP 传输大文件卡住 → `Ctrl+C` 取消，改用 CI 部署（`git push`）。

---

## 四、日常快速查

| 你要做什么    | 命令 |
|----------|------|
| 有历史记录的h` |

---

> **💡 核心原则**：大多数时候你只需要 `git push`。其他命令都是备用方案。
