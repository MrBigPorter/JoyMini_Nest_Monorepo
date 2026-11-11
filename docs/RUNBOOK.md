# 本地运行手册（RUNBOOK）

> 版本: v1.0
> 日期: 2026-11-11
> 适用: 本地开发环境（Colima + Docker Compose）
> 部署相关见 [full-deployment-guide.md](./full-deployment-guide.md)

---

## 0. 先搞清楚三件事

| 问题 | 命令 | 说明 |
|---|---|---|
| 虚拟机起了吗 | `colima status` | 没起就先 `colima start` |
| 容器什么状态 | `docker ps -a --format '{{.Names}}\t{{.Status}}'` | 只看 `Up` 的 |
| 内存够吗 | `make mem` | Colima 默认 4GB |

**`Exited (255)` 是什么意思**：上次关机时容器没有正常退出。不是坏了，重新起就行。

---

## 1. 三档启动（按内存从小到大）

### 只想跑数据库（~500MB）

```bash
colima start          # 电脑重启后先跑这个
make up-db            # db + redis
```

用在你**后端在宿主机跑**的时候：

```bash
make dev-api          # 本地起 Nest，不走 Docker
```

### 要跑完整后端（~1.5GB）

```bash
make up-backend       # db + redis + backend
```

### 要测 AI 对话（~3GB）

```bash
make up-ai            # db + redis + backend + nginx + meilisearch
```

### 日常全开（~3.2GB）

```bash
make up-dev        # db + redis + backend + nginx + meilisearch
make start-admin   # 另起 admin 前端（跑在宿主机，不进 Docker）
```

> ⚠️ `admin-next` **不在 compose.yml 里**，它跑在宿主机 4001，由 nginx 反代到
> `http://admin-dev.joyminis.com`（需 `/etc/hosts` 有 `127.0.0.1 admin-dev.joyminis.com`）。

---

## 2. 单个服务启停

```bash
make start-db            # 起 PostgreSQL
make start-redis         # 起 Redis
make start-backend       # 起后端（会重新 build）
make start-meilisearch   # 起 Meilisearch
make start-nginx         # 起 Nginx
make start-frontend      # blog + nginx
make start-admin         # admin 前端（宿主机，端口 4001）

make stop-db
make stop-redis
make stop-backend
make stop-meilisearch
make stop-admin
make stop-ai             # 只停 AI 服务，省内存
make stop-extra          # 停所有非核心（保留 db + redis + backend）
```

**单个容器直接操作**（不经过 make）：

```bash
docker start joymini-meilisearch
docker stop  joymini-meilisearch
docker logs  --tail 100 lucky-backend-dev
```

---

## 3. 常见场景对照

| 我想…… | 跑这个 |
|---|---|
| 改后端代码，热更新 | `make up-db` + `make dev-api` |
| 跑数据库迁移 | `make up-db` → `make migrate-local` |
| 看数据库内容 | `make up-db` → `make prisma-studio-local` |
| 测 AI 对话（含 BM25 检索） | `make up-ai` |
| 只调前端 | `make up-db` + `make start-backend` + `make start-admin` → http://admin-dev.joyminis.com |
| 省内存 | `make stop-ai` / `make stop-extra` |
| 全部关掉 | `make down` → `colima stop` |

---

## 4. 环境变量在哪

```
.env  →  deploy/.env.dev   （符号链接）
```

改配置改 `deploy/.env.dev`，不要改 `.env`（它是链接）。

**生产用 `deploy/.env.prod` + `compose.prod.yml`。**

---

## 5. 排查

### 容器起不来

```bash
docker logs --tail 50 <容器名>
docker compose up <服务名>        # 前台跑，直接看报错
```

### 端口被占

```bash
lsof -i :5432    # PostgreSQL
lsof -i :6379    # Redis
lsof -i :3000    # backend
lsof -i :7700    # Meilisearch
```

### 想从零重建

```bash
make down
docker compose rm -f
docker volume rm joymini_meili_data   # 注意：会删数据
```

### 内存爆了

```bash
make mem
make stop-extra
```

---

## 6. 服务清单与端口

| 服务 | 容器名 | 端口 | 内存 |
|---|---|---|--:|
| PostgreSQL | lucky-db | 5432 | ~200MB |
| Redis | lucky-redis | 6379 | ~30MB |
| 后端 | lucky-backend-dev | 3000 | ~1GB |
| Nginx | lucky-nginx-dev | 80 | ~10MB |
| Meilisearch | joymini-meilisearch | 7700 | ~100MB |
| Admin | 宿主机进程（`make start-admin`） | 4001 | ~300MB |
| Blog | frontend-blog | 3002 | ~300MB |
| Infinity | joymini-infinity | 7997 | 仅 prod |

---

## 变更记录

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-11-11 | v1.0 | 首版；同时修复 Makefile 缺失 `start-meilisearch` 目标 |
| 2026-11-11 | v1.1 | 修正：admin 跑在宿主机 4001（不是 Docker/3001）；`up-dev` 不再含 admin；补 `admin-dev.joyminis.com` 访问说明 |
