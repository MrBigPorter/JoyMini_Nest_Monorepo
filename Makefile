# ==========================================
# Lucky Nest Monorepo — 常用命令
# ==========================================
# 使用: make <target>
# 例如: make setup   make up   make down
# ==========================================

.PHONY: setup up down restart logs ps build clean help \
        dev-next exec-api migrate seed

.DEFAULT_GOAL := help

# ──────────────────────────────────────────
# 初始化
# ──────────────────────────────────────────

## [初始化] 首次 clone 后运行：创建 .env 软链接
setup:
	@echo "→ 创建 .env 软链接 → deploy/.env.dev"
	@ln -sf deploy/.env.dev .env
	@echo " 完成！运行 make up 启动全套环境"
	@echo "   或运行 make up-infra + make dev-next 启动（前端热更新更快）"

# ──────────────────────────────────────────
# Docker 全套环境
# ──────────────────────────────────────────

## [Docker] 启动全套开发环境（后端 + 前端 + DB + Redis）
up:
	docker compose up -d --build

## [Docker] 只启动基础设施（DB + Redis + 后端 + Nginx，不含前端容器）
up-infra:
	docker compose up -d --build db redis backend nginx

## [Docker] 停止所有容器
down:
	docker compose down

## [Docker] 重启所有服务
restart:
	docker compose restart

## [Docker] 查看所有服务日志（Ctrl+C 退出）
logs:
	docker compose logs -f

## [Docker] 查看指定服务日志（用法: make log s=backend）
log:
	docker compose logs -f $(s)

## [Docker] 查看运行状态
ps:
	docker compose ps

## [Docker] 重新构建镜像（依赖变更后使用）
build:
	docker compose build --no-cache

## [Docker] ⚠️  清理容器 + 镜像 + 卷（会删除数据库数据！）
clean:
	docker compose down -v --remove-orphans
	docker image prune -f

# ──────────────────────────────────────────
# 本地前端（比容器 HMR 更快）
# ──────────────────────────────────────────

## [前端] 在本机直接运行 admin-next dev（需先 make up-infra）
dev-next:
	yarn workspace @lucky/admin-next dev

# ──────────────────────────────────────────
# 数据库 / 后端
# ──────────────────────────────────────────

## [DB] 进入后端容器 shell
exec-api:
	docker compose exec backend sh

## [DB] 运行 Prisma 迁移（容器内）
migrate:
	docker compose exec backend yarn workspace @lucky/api prisma migrate dev

## [DB] 重置数据库并运行 seed（⚠️ 清空数据）
seed:
	docker compose exec backend yarn workspace @lucky/api seed

# ──────────────────────────────────────────
# 帮助
# ──────────────────────────────────────────

## 显示帮助
help:
	@echo ""
	@echo "  Lucky Nest — 开发环境命令"
	@echo "  ─────────────────────────────────────────"
	@grep -E '^## ' Makefile | sed 's/## /  /'
	@echo ""
