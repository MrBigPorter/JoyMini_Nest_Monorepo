# Lucky Nest 运维手册

> **💡 核心原则**：大多数时候你只需要 `git push`。其他命令都是备用方案。

---

## 一、怎么部署？

### ✅ 方式 1：推送代码到 GitHub（推荐，最简单）

你只需要：

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
VPS_IP=<你的服务器IP> ./deploy/deploy.sh --backend

# 部署全部（后端 + 前端）
VPS_IP=<你的服务器IP> ./deploy/deploy.sh
```

> 本地部署流程：本地构建 Docker 镜像 → 压缩 → SCP 传到 VPS → VPS 加载镜像 → 重启容器。

---

## 二、怎么改配置？（环境变量）

### 2.1 配置文件在哪？

| 文件 | 用途 | 是否提交到 Git |
|------|------|---------------|
| `deploy/.env.dev` | 开发环境配置 | ❌ 不提交 |
| `deploy/.env.prod` | **生产环境**配置（数据库密码、API Key 等） | ❌ 不提交 |
| `deploy/.env.example` | 配置模板，告诉你需要填哪些项 | ✅ 提交 |

> ⚠️ `.env.prod` 不会提交到 GitHub（安全原因），所以 **CI 部署不会自动同步这个文件**。

### 2.2 改了配置后，怎么做？（3 步）

**场景**：你改了 `deploy/.env.prod` 里的 GROQ_API_KEY、数据库密码等配置。

**步骤一**：本地修改文件

用编辑器打开 `deploy/.env.prod`，修改你需要改的内容，保存。

**步骤二**：把文件传到 VPS

```bash
scp deploy/.env.prod root@<你的服务器IP>:/opt/lucky/deploy/
```

> 不知道服务器 IP？去 GitHub → 你的仓库 → Settings → Secrets and variables → Actions → 看 `SSH_HOST` 的值。

**步骤三**：让 Docker 重新读取配置

```bash
ssh root@<你的服务器IP> 'cd /opt/lucky && docker compose -f compose.prod.yml --env-file deploy/.env.prod up -d --no-build --force-recreate backend'
```

### 2.3 ⚠️ 最容易犯的错

```bash
# ❌ 这样没用！restart 不会重新读取配置文件
docker restart lucky-backend-prod

# ✅ 要用上面的步骤三那个命令
```

**为什么 restart 不行？**（不想看可以跳过）

> Docker 容器就像一台组装好的电脑。`restart` 只是按一下重启键，里面的配置不变。
> `--force-recreate` 是重新组装一台电脑，这时候才会用新的配置单（`.env.prod`）。

---

## 三、怎么看部署成没成功？

### 看 CI 状态

去 GitHub → 你的仓库 → `Actions` 标签 → 最新的 `Deploy Backend` 工作流：

| 图标 | 含义 |
|------|------|
| ✅ 绿色 | 部署成功 |
| ❌ 红色 | 部署失败 → 点进去看哪个步骤红了 |

### 直接测接口

```bash
# 测后端是否活着
curl https://api.joyminis.com/api/v1/health

# 正常返回：{"code":10000,"message":"success","data":{"ok":true}}
```

### SSH 进 VPS 看

```bash
# 登录 VPS
ssh root@<你的服务器IP>

# 看所有容器状态
docker ps -a

# 看后端日志（最近 50 行）
docker logs --tail=50 lucky-backend-prod
```

---

## 四、怎么查看和管理容器？

### 4.1 查看所有容器状态

```bash
ssh root@<你的服务器IP> 'docker ps -a'
```

输出示例：
```
CONTAINER ID   IMAGE                                        STATUS         NAMES
abc123         lucky-backend-prod:latest                    Up 2 hours     lucky-backend-prod
def456         nginx:latest                                  Up 2 hours     lucky-nginx-prod
ghi789         postgres:16-alpine                            Up 2 hours     lucky-db-prod
```

- `Up` = 正常运行
- `Exited` = 挂了
- `Restarting` = 正在重启

### 4.2 查看后端日志（出问题先看这个）

```bash
ssh root@<你的服务器IP> 'docker logs --tail=50 lucky-backend-prod'
```

想看实时日志（Ctrl+C 退出）：

```bash
ssh root@<你的服务器IP> 'docker logs -f --tail=50 lucky-backend-prod'
```

### 4.3 查看其他容器日志

```bash
# Nginx 日志
ssh root@<你的服务器IP> 'docker logs --tail=50 lucky-nginx-prod'

# 数据库日志
ssh root@<你的服务器IP> 'docker logs --tail=50 lucky-db-prod'
```

### 4.4 进入容器内部（调试用）

```bash
ssh root@<你的服务器IP> 'docker exec -it lucky-backend-prod sh'
```

---

## 五、数据库相关

### 5.1 手动运行数据库迁移

改了数据库模型（`schema.prisma`）后，需要运行迁移：

```bash
ssh root@<你的服务器IP> 'cd /opt/lucky && docker run --rm \
  --network lucky_app \
  --env-file deploy/.env.prod \
  --entrypoint "" \
  ghcr.io/mrbigporter/lucky-backend-prod:latest \
  ./node_modules/.bin/prisma migrate deploy \
    --schema=apps/api/prisma/schema.prisma'
```

> 通常 CI 部署会自动运行迁移，不需要手动执行。

### 5.2 备份数据库

```bash
ssh root@<你的服务器IP> 'bash /opt/lucky/deploy/backup.sh'
```

备份文件会保存在 VPS 上。

### 5.3 恢复数据库

```bash
ssh root@<你的服务器IP> 'bash /opt/lucky/deploy/rollback.sh --db'
```

> ⚠️ 恢复数据库会丢失备份时间点之后的数据，谨慎操作！

---

## 六、Nginx 配置

### 6.1 改了 nginx 配置后怎么做？

Nginx 配置文件在：
- `nginx/nginx.prod.conf` - 主要配置
- `nginx/whitelist.conf` - IP 白名单

改了配置后，推送到 GitHub 会自动同步到 VPS 并重载。

如果需要手动操作：

```bash
# 1. 把配置传到 VPS
scp nginx/nginx.prod.conf root@<你的服务器IP>:/opt/lucky/nginx/
scp nginx/whitelist.conf root@<你的服务器IP>:/opt/lucky/nginx/

# 2. 校验配置有没有写错
ssh root@<你的服务器IP> 'docker exec lucky-nginx-prod nginx -t'

# 3. 如果显示 "test is successful"，重载配置
ssh root@<你的服务器IP> 'docker exec lucky-nginx-prod nginx -s reload'
```

### 6.2 常见配置问题

- **配置语法错误**：`nginx -t` 会报错，根据提示修改
- **证书过期**：检查 `certs/` 目录下的证书文件
- **端口冲突**：检查是否有其他程序占用了 80/443 端口

---

## 七、出问题了怎么办？

### ❌ 接口返回 404

```bash
# 1. 先确认后端是否在跑
ssh root@<你的服务器IP> 'docker ps | grep lucky-backend'

# 2. 如果不在跑，重启后端
ssh root@<你的服务器IP> 'cd /opt/lucky && docker compose -f compose.prod.yml restart backend'

# 3. 如果在跑还是 404，可能跑的是旧代码 → 强制重新创建
ssh root@<你的服务器IP> 'cd /opt/lucky && BACKEND_IMAGE=lucky-backend-prod:latest docker compose -f compose.prod.yml up -d --no-deps --force-recreate backend'
```

### ❌ AI 翻译只有 Gemini，没有 Groq/DeepSeek

**原因**：改了 `deploy/.env.prod` 里的 API Key，但没有让 Docker 重新读取。

**解决办法**：看上面的 [第二章 2.3 节](#23-最容易犯的错)。

### ❌ 容器老是挂（OOM 内存溢出）

```bash
# 查看容器是否因为内存不足被杀死
ssh root@<你的服务器IP> 'docker inspect lucky-backend-prod --format "{{.State.Status}} - {{.State.FinishedAt}}"'

# 查看内存使用情况
ssh root@<你的服务器IP> 'docker stats --no-stream'
```

如果频繁 OOM，可能需要：
1. 检查是否有内存泄漏
2. 在 `compose.prod.yml` 中调大 `memory: 300M` 的限制

### ❌ CI 显示红色

1. 点进 GitHub Actions 看哪个步骤红了
2. 常见原因：
   - **Nginx 配置错误**：VPS 上 `/etc/nginx/conf.d/` 有语法问题
   - **代码检查失败**：本地跑 `yarn workspace @lucky/api lint` 看报什么错
   - **SSH 连不上 VPS**：网络问题，等几分钟重试

### ❌ 本地 `deploy.sh` 卡住了

网络慢，SCP 传输大文件卡住 → `Ctrl+C` 取消，改用 CI 部署（`git push`）。

---

## 八、常用命令速查

| 你要做什么 | 命令 |
|-----------|------|
| **部署后端** | `git push`（推荐）或 `VPS_IP=<IP> ./deploy/deploy.sh --backend` |
| **查看后端日志** | `ssh root@<IP> 'docker logs --tail=50 lucky-backend-prod'` |
| **实时看日志** | `ssh root@<IP> 'docker logs -f --tail=50 lucky-backend-prod'` |
| **重启后端** | `ssh root@<IP> 'cd /opt/lucky && docker compose -f compose.prod.yml restart backend'` |
| **强制重建后端**（改配置后用） | `ssh root@<IP> 'cd /opt/lucky && docker compose -f compose.prod.yml --env-file deploy/.env.prod up -d --no-build --force-recreate backend'` |
| **查看所有容器** | `ssh root@<IP> 'docker ps -a'` |
| **查看容器内存** | `ssh root@<IP> 'docker stats --no-stream'` |
| **同步配置文件到 VPS** | `scp deploy/.env.prod root@<IP>:/opt/lucky/deploy/` |
| **校验 nginx 配置** | `ssh root@<IP> 'docker exec lucky-nginx-prod nginx -t'` |
| **重载 nginx 配置** | `ssh root@<IP> 'docker exec lucky-nginx-prod nginx -s reload'` |
| **备份数据库** | `ssh root@<IP> 'bash /opt/lucky/deploy/backup.sh'` |
| **进入后端容器** | `ssh root@<IP> 'docker exec -it lucky-backend-prod sh'` |

---

## 九、常见问题

### Q: 我改了 .env.prod，为什么线上没生效？
A: 因为你只 `docker restart` 了。看 [第二章 2.3 节](#23-最容易犯的错)。

### Q: CI 部署成功了，但功能还是不对？
A: 可能 CI 部署的是旧代码。检查 GitHub Actions 的 `Build & Push` 步骤是否用了正确的 commit。

### Q: 怎么看当前跑的是哪个版本的代码？
A: 
```bash
ssh root@<你的服务器IP> 'docker inspect lucky-backend-prod --format "{{.Config.Image}}"'
```

### Q: 数据库连不上了怎么办？
A: 
```bash
# 检查数据库容器是否在跑
ssh root@<你的服务器IP> 'docker ps | grep lucky-db'

# 查看数据库日志
ssh root@<你的服务器IP> 'docker logs --tail=50 lucky-db-prod'
```

### Q: 如何查看 VPS 的磁盘和内存使用情况？
A:
```bash
ssh root@<你的服务器IP> 'df -h && echo "---" && free -h'
```
