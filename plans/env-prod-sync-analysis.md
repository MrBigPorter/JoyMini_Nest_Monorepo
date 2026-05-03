# 分析：CI 部署为什么没有更新 `.env.prod`

## 问题

用户观察到这次 CI 部署（GitHub Actions）过程中，`deploy/.env.prod` 没有被同步到 VPS 服务器上。

## 现状分析

### 1. CI Workflow 同步了什么？

查看 [`deploy-backend.yml`](.github/workflows/deploy-backend.yml) 的 Step 2（SCP 同步阶段）：

| 步骤 | 同步内容 | 目标路径 |
|------|---------|---------|
| Step 2 / 2.1 | `deploy/*.sh` | `/opt/lucky/deploy` |
| Step 2.2 | `nginx/nginx.prod.conf`, `nginx/whitelist.conf` | `/opt/lucky/nginx` |
| **缺失** | **`deploy/.env.prod`** | **未同步** |

CI workflow **没有**包含同步 `deploy/.env.prod` 到 VPS 的步骤。

### 2. 本地部署脚本做了什么？

对比本地 [`deploy/deploy.sh`](deploy/deploy.sh) 脚本中的 `sync_configs()` 函数：

```bash
scp compose.prod.yml                    "$SSH_TARGET:$VPS_DIR/"
scp Makefile                            "$SSH_TARGET:$VPS_DIR/"
scp deploy/.env.prod                    "$SSH_TARGET:$VPS_DIR/deploy/"   # ← 有同步
scp deploy/init-db.sh                   "$SSH_TARGET:$VPS_DIR/deploy/"
...
```

本地脚本**确实**同步了 `.env.prod`，但 CI workflow **没有**。

### 3. 为什么 CI 没同步也能工作？

因为 CI 的 Step 3（SSH 部署脚本）中使用了 `--env-file deploy/.env.prod`：

```bash
docker run --rm \
  --network "$NETWORK" \
  --env-file deploy/.env.prod \    # ← 引用 VPS 上已有的文件
  ...
```

VPS 上 `/opt/lucky/deploy/.env.prod` 是**上一次**手动部署或本地部署时留下的旧版本。只要没有新增/修改环境变量，旧文件也能正常工作。

### 4. 什么时候会出问题？

当以下情况发生时，VPS 上的 `.env.prod` 会与仓库中的不一致：

- 新增了环境变量（如新的 API key）
- 修改了现有环境变量的值
- 删除了某个环境变量

这时通过 CI 部署，新镜像可能读取不到新的环境变量，或者读取到旧值。

## 根本原因

**CI workflow 和本地部署脚本行为不一致** — 本地 `deploy.sh` 会同步 `.env.prod`，但 CI workflow 遗漏了这个步骤。

## 可能的解决方案

### 方案 A：在 CI workflow 中添加 .env.prod 同步步骤

在 [`deploy-backend.yml`](.github/workflows/deploy-backend.yml) 的 Step 2 中增加一个 scp-action，同步 `deploy/.env.prod` 到 `/opt/lucky/deploy`。

**优点**：与本地部署脚本行为一致，配置变更立即生效。
**缺点**：`.env.prod` 包含敏感信息（数据库密码、API密钥等），放在 Git 仓库中本身就有安全隐患。如果 workflow 自动同步，任何能 push 到 main 的人都能修改生产配置。

### 方案 B：通过 GitHub Secrets 管理敏感配置

将敏感环境变量从 `.env.prod` 中剥离，改为通过 GitHub Actions Secrets 注入到 CI 流程中，在 SSH 脚本中动态写入 VPS。

**优点**：更安全，敏感信息不存储在 Git 仓库中。
**缺点**：改动较大，需要重构配置管理方式。

### 方案 C：维持现状，手动管理

`.env.prod` 只在需要变更时通过本地 `deploy/deploy.sh --sync` 手动同步。

**优点**：不需要改动 CI，对生产环境配置变更更谨慎（人为控制）。
**缺点**：容易忘记同步，导致 CI 部署后配置不一致。

## 建议

如果 `.env.prod` 中的敏感信息（密码、密钥等）已经提交到 Git 仓库（目前确实如此），那么**方案 A** 是最直接且与现有行为一致的修复方式。如果希望加强安全，后续可以逐步迁移到**方案 B**。
