# ==========================================
# Lucky Nest Monorepo — 开发环境命令
# ==========================================
# 使用: make <target>
# 例如: make setup   make up   make down
# ==========================================

.PHONY: setup up up-infra down restart logs ps build clean wipe help \
        dev-admin dev-blog exec-api migrate seed prisma-studio \
        check-dockerfiles generate-certs \
        check fix audit type-check \
        deploy deploy-backend deploy-admin deploy-quick deploy-sync \
        rollback rollback-backend rollback-db \
        switch-admin-dns rollback-admin-dns verify-blog-cache \
        logs-prod logs-backend logs-nginx logs-db logs-turn

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
			   dev.joyminis.com blog-dev.joyminis.com admin-dev.joyminis.com blog-admin-dev.joyminis.com dev-api.joyminis.com localhost 127.0.0.1; \
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
# 代码质量 (lint / fix / audit)
# ──────────────────────────────────────────

## [质量] 🔍 运行全量 lint（与 CI 一致，检测 ERROR）
check:
	yarn turbo run lint

## [质量] 🧪 运行全量 TypeScript 严格类型检查（tsc --noEmit，覆盖所有 workspace）
type-check:
	@echo "==> Running strict type-check across all workspaces..."
	@echo ""
	@echo "  [1/3] @lucky/api..."
	-yarn workspace @lucky/api check-types 2>&1 | tail -5
	@echo ""
	@echo "  [2/3] @lucky/admin-next..."
	-yarn workspace @lucky/admin-next check-types 2>&1 | tail -5
	@echo ""
	@echo "  [3/3] @lucky/frontend-blog..."
	-yarn workspace @lucky/frontend-blog check-types 2>&1 | tail -5
	@echo ""
	@echo "✅ Type-check complete. Review any errors above."

## [质量] 🔧 自动修复可修复问题（prettier + eslint --fix）
fix:
	@echo "==> Prettier: formatting all files..."
	yarn prettier --write "**/*.{ts,tsx,js,jsx,json,md,css,scss,mjs,cjs}"
	@echo ""
	@echo "==> ESLint: auto-fixing what's fixable..."
	-yarn workspace @lucky/api lint --fix 2>/dev/null
	-yarn workspace @lucky/frontend-blog lint --fix 2>/dev/null
	-yarn workspace @lucky/admin-next lint --fix 2>/dev/null
	@echo ""
	@echo "✅ Auto-fix complete. Remaining issues (if any) require manual fixes."
	@echo "   Run 'make check' to verify."

## [质量] 📊 按严重程度分类的警告报告
define audit_workspace
	@echo "========================================"
	@echo "  $(1)"
	@echo "========================================"
	@echo ""
	@echo "  🔴 CRITICAL (potential bugs)"
	@echo "  -------------------------------"
	@yarn workspace $(1) lint 2>&1 | grep -E "warning" | grep -E "no-floating-promises|require-await|no-unnecessary-type-assertion|no-base-to-string|await-thenable|react-hooks/exhaustive-deps" | sed 's/^/    /' || echo "    (none)"
	@echo ""
	@echo "  🟡 MEDIUM (type safety)"
	@echo "  -------------------------------"
	@yarn workspace $(1) lint 2>&1 | grep -E "warning" | grep -E "no-unsafe-(member-access|assignment|argument|return|call|enum-comparison)|restrict-template-expressions|no-explicit-any|ban-ts-comment" | sed 's/^/    /' || echo "    (none)"
	@echo ""
	@echo "  ⚪ LOW (code quality)"
	@echo "  -------------------------------"
	@yarn workspace $(1) lint 2>&1 | grep -E "warning" | grep -E "no-unused-vars|prettier/prettier|no-useless-escape|no-empty|no-require-imports|no-img-element|import/no-anonymous-default-export" | sed 's/^/    /' || echo "    (none)"
	@echo ""
	@echo "  📊 Summary"
	@echo "  -------------------------------"
	@yarn workspace $(1) lint 2>&1 | grep -E "^✖" | sed 's/^/    /'
	@echo ""
endef

audit:
	@echo ""
	@echo "╔══════════════════════════════════════════════╗"
	@echo "║   🔍 Categorized Warning Audit              ║"
	@echo "╚══════════════════════════════════════════════╝"
	@echo ""
	$(call audit_workspace,@lucky/api)
	$(call audit_workspace,@lucky/admin-next)
	$(call audit_workspace,@lucky/frontend-blog)

# ──────────────────────────────────────────
# 生产部署 (VPS)
# ──────────────────────────────────────────
# 所有 deploy/rollback 命令会交互式提示输入 VPS_IP，
# 也可以在调用时用 VPS_IP=1.2.3.4 预设：
#   make deploy VPS_IP=1.2.3.4
# ──────────────────────────────────────────

## [Deploy] 🚀 全量部署 (后端 + 前端)
deploy:
	bash deploy/deploy.sh

## [Deploy] 仅部署后端
deploy-backend:
	bash deploy/deploy.sh --backend

## [Deploy] 仅部署前端 (admin-next)
deploy-admin:
	bash deploy/deploy.sh --admin

## [Deploy] 跳过构建，仅重启服务
deploy-quick:
	bash deploy/deploy.sh --quick

## [Deploy] 仅同步配置文件
deploy-sync:
	bash deploy/deploy.sh --sync

## [Rollback] 🔙 回滚容器 (后端 + 前端)
rollback:
	bash deploy/rollback.sh

## [Rollback] 仅回滚后端
rollback-backend:
	bash deploy/rollback.sh --backend

## [Rollback] ⚠️ 恢复数据库备份 (高风险!)
rollback-db:
	bash deploy/rollback.sh --db

## [Cloudflare] 🔁 切换 admin DNS 到 Cloudflare Workers (dry-run)
switch-admin-dns:
	bash deploy/switch-admin-cloudflare.sh

## [Cloudflare] 🔁 切换 admin DNS 回 VPS (dry-run)
rollback-admin-dns:
	bash deploy/cloudflare-rollback.sh

## [Cloudflare] ✅ 验证 blog 前端缓存状态 (Cloudflare Workers)
verify-blog-cache:
	bash deploy/verify-blog-cache.sh

# ──────────────────────────────────────────
# 生产日志 (VPS)
# ──────────────────────────────────────────
# 这些命令会通过 SSH 连接到 VPS 查看生产容器日志。
# 终端会交互式提示输入 VPS_IP，也可以在调用时预设：
#   make logs-prod VPS_IP=1.2.3.4
# ──────────────────────────────────────────

## [Logs] 📝 查看 VPS 所有服务日志 (Ctrl+C 退出，类似 tail -f)
logs-prod:
	@if [ -z "$(VPS_IP)" ]; then \
		read -p "VPS IP: " VPS_IP; \
		ssh root@$$VPS_IP 'docker compose -f /opt/lucky/compose.prod.yml logs -f'; \
	else \
		ssh root@$(VPS_IP) 'docker compose -f /opt/lucky/compose.prod.yml logs -f'; \
	fi

## [Logs] 🔙 查看后端日志 (Ctrl+C 退出)
logs-backend:
	@if [ -z "$(VPS_IP)" ]; then \
		read -p "VPS IP: " VPS_IP; \
		ssh root@$$VPS_IP 'docker logs -f --tail=100 lucky-backend-prod'; \
	else \
		ssh root@$(VPS_IP) 'docker logs -f --tail=100 lucky-backend-prod'; \
	fi

## [Logs] 🌐 查看 Nginx 日志 (最近 50 行)
logs-nginx:
	@if [ -z "$(VPS_IP)" ]; then \
		read -p "VPS IP: " VPS_IP; \
		ssh root@$$VPS_IP 'docker logs --tail=50 lucky-nginx-prod'; \
	else \
		ssh root@$(VPS_IP) 'docker logs --tail=50 lucky-nginx-prod'; \
	fi

## [Logs] 🗄️ 查看数据库日志 (最近 50 行)
logs-db:
	@if [ -z "$(VPS_IP)" ]; then \
		read -p "VPS IP: " VPS_IP; \
		ssh root@$$VPS_IP 'docker logs --tail=50 lucky-db-prod'; \
	else \
		ssh root@$(VPS_IP) 'docker logs --tail=50 lucky-db-prod'; \
	fi

## [Logs] 📞 查看 TURN 服务器日志 (最近 100 行)
logs-turn:
	@if [ -z "$(VPS_IP)" ]; then \
		read -p "VPS IP: " VPS_IP; \
		ssh root@$$VPS_IP 'tail -n 100 /var/log/turnserver.log'; \
	else \
		ssh root@$(VPS_IP) 'tail -n 100 /var/log/turnserver.log'; \
	fi

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
	@echo "  💡 生产部署/日志时 VPS IP 会在终端交互式提示输入"
	@echo "     也可预设: make deploy VPS_IP=1.2.3.4"
	@echo ""
