# ==========================================
# Lucky Nest Monorepo — 开发环境命令
# ==========================================
# 使用: make <target>
# 例如: make setup   make up   make down
# ==========================================

.PHONY: setup up up-infra down restart logs ps build clean wipe help \
        dev-admin dev-blog exec-api migrate seed prisma-studio \
        check-dockerfiles generate-certs

.DEFAULT_GOAL := help

# ──────────────────────────────────────────
# 初始化
# ──────────────────────────────────────────

## [初始化] 首次 clone 后运行：创建 .env 软链接 + 生成开发证书
setup: generate-certs
	@echo "→ 创建 .env 软链接 → deploy/.env.dev"
	@ln -sf deploy/.env.dev .env
	@echo "✓ 完成！"
	@echo "👉 运行 'make up' 启动全套环境"
	@echo "👉 或运行 'make up-infra' 后，再新开终端运行 'make dev-admin' 或 'make dev-blog'"

## [证书] 生成多域名 SAN 开发自签名证书 (依赖 mkcert)
generate-certs:
	@if [ ! -f certs/dev.joyminis.com.pem ]; then \
		echo "→ 使用 mkcert 生成受信任的开发证书..."; \
		mkdir -p certs; \
		mkcert -key-file certs/dev.joyminis.com-key.pem \
			   -cert-file certs/dev.joyminis.com.pem \
			   dev.joyminis.com *.dev.joyminis.com localhost 127.0.0.1; \
		chmod 644 certs/*; \
		echo "✓ 证书生成成功，已经被系统信任！"; \
	else \
		echo "✓ 开发证书已存在"; \
	fi

# ──────────────────────────────────────────
# Docker 全套环境
# ──────────────────────────────────────────

## [Docker] 检查 Dockerfile 一致性（Yarn 版本等）
check-dockerfiles:
	@bash scripts/check-yarn-version.sh

## [Docker] 🚀 启动全套开发环境（自动清理幽灵容器，防止冲突）
up: check-dockerfiles
	docker compose up -d --build --remove-orphans

## [Docker] 🚀 只启动基础设施（DB + Redis + API + Nginx，适合配合本地前端调试）
up-infra: check-dockerfiles
	docker compose up -d --build --remove-orphans db redis backend nginx

## [Docker] 🛑 停止所有容器（自动清理孤儿容器）
down:
	docker compose down --remove-orphans

## [Docker] 🔄 重启所有服务
restart:
	docker compose restart

## [Docker] 重新构建镜像（改动 package.json 或 Dockerfile 后使用）
build: check-dockerfiles
	docker compose build --no-cache

## [Docker] 📋 查看运行状态
ps:
	docker compose ps

## [Docker] 📝 查看所有服务日志（Ctrl+C 退出）
logs:
	docker compose logs -f

## [Docker] 📝 查看指定服务日志（用法: make log s=backend）
log:
	docker compose logs -f $(s)

# ──────────────────────────────────────────
# 危险操作区 (清理与重置)
# ──────────────────────────────────────────

## [环境清理] 🧹 清理容器和未使用的镜像（不删数据库数据！）
clean:
	docker compose down --remove-orphans
	docker image prune -f
	@echo "✓ 环境已清理（数据库和 Redis 数据已保留）"

## [终极重置] ⚠️ 格式化：清理一切，包括数据库和缓存数据（谨慎使用！）
wipe:
	docker compose down -v --remove-orphans
	docker image prune -a -f
	@echo "☠️  所有容器、网络、镜像及数据卷已被彻底清除！"

# ──────────────────────────────────────────
# 本地前端开发 (比 Docker HMR 响应更快)
# ──────────────────────────────────────────

## [前端] 启动 Admin 后台 (需先 make up-infra)
dev-admin:
	yarn workspace @lucky/admin-next dev

## [前端] 启动 Blog 前台 (使用 Turbopack, 需先 make up-infra)
dev-blog:
	cd apps/frontend-blog && PORT=4002 yarn dev --turbopack -p 4002

# ──────────────────────────────────────────
# 数据库 / 后端开发辅助
# ──────────────────────────────────────────

## [API] 进入后端容器 Shell
exec-api:
	docker compose exec backend sh

## [DB] 运行 Prisma 结构迁移 (同步数据库)
migrate:
	docker compose exec backend yarn workspace @lucky/api prisma migrate dev

## [DB] 重置数据库并运行 Seed (⚠️ 会清空现有数据)
seed:
	docker compose exec backend yarn workspace @lucky/api seed

## [DB] 打开 Prisma Studio (网页版可视化数据库)
prisma-studio:
	docker compose exec backend yarn workspace @lucky/api prisma studio

# ──────────────────────────────────────────
# 帮助
# ──────────────────────────────────────────

## [Help] 显示此帮助信息
help:
	@echo ""
	@echo "  🚀 Lucky Nest — 开发者工具箱"
	@echo "  ─────────────────────────────────────────"
	@grep -E '^## ' Makefile | sed 's/## /  /'
	@echo ""