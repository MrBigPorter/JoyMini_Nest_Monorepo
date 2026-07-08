# ==========================================
# JoyMini Nest Monorepo — Dev Command Center
# ==========================================
# Usage: make <target>
# Examples: make setup   make up   make down
# ==========================================


.PHONY: setup up up-core up-ai up-dev up-blog up-all up-infra down restart logs ps build clean wipe help menu \
        stop-ai stop-blog stop-all-extra \
        start-ollama start-infinity start-meilisearch start-blog mem \
        start-unstructured stop-unstructured unstructured-status \
        dev-admin dev-blog dev-blog-clean exec-api migrate seed prisma-studio \
        check-dockerfiles generate-certs \
        check format fix audit type-check \
        deploy deploy-backend deploy-admin deploy-quick deploy-sync \
        rollback rollback-backend rollback-db \
        switch-admin-dns rollback-admin-dns verify-blog-cache \
        publish-blog-docs \
        logs-prod logs-backend logs-nginx logs-db logs-turn \
        aws-load-test aws-check-scaling aws-scaling-activities aws-check-cpu \
        aws-force-deploy aws-ecs-logs aws-ecs-exec aws-cost-check \
        aws-stop-all aws-start-all \
        aws-sync-dlq-check aws-sync-dlq-purge \
        ollama-start ollama-stop ollama-restart ollama-status ollama-logs \
        ollama-pull ollama-list ollama-ps ollama-run ollama-rm \
        ollama-test ollama-health

.DEFAULT_GOAL := help

# ──────────────────────────────────────────
# Setup
# ──────────────────────────────────────────

## [Setup] First-time clone: create .env symlink + generate dev certs
setup: generate-certs
	@echo "→ Creating .env symlink → deploy/.env.dev"
	@ln -sf deploy/.env.dev .env
	@echo "✓ Done!"
	@echo "👉 Run 'make up' to start full stack"
	@echo "👉 Or run 'make up-infra' first, then 'make dev-admin' or 'make dev-blog' in another terminal"

## [Certs] Generate multi-domain SAN dev certs (requires mkcert)
generate-certs:
	@if [ ! -f certs/dev.joyminis.com.pem ]; then \
		echo "→ Generating trusted dev certs with mkcert..."; \
		mkdir -p certs; \
		mkcert -key-file certs/dev.joyminis.com-key.pem \
			   -cert-file certs/dev.joyminis.com.pem \
			   dev.joyminis.com blog-dev.joyminis.com admin-dev.joyminis.com blog-admin-dev.joyminis.com dev-api.joyminis.com localhost 127.0.0.1; \
		chmod 644 certs/*; \
		echo "✓ Certs generated and trusted by system!"; \
	else \
		echo "✓ Dev certs already exist"; \
	fi

# ──────────────────────────────────────────
# Docker (Full Stack)
# ──────────────────────────────────────────

## [Docker] Check Dockerfile consistency (Yarn version etc.)
check-dockerfiles:
	@bash scripts/check-yarn-version.sh

## [Docker] 🚀 Start full dev stack (auto-removes orphan containers)
up: check-dockerfiles
	docker compose up -d --build --remove-orphans

## [Docker] 🚀 Start only core infrastructure (DB + Redis + API + Nginx, ~800MB)
up-core: check-dockerfiles
	docker compose up -d --build --remove-orphans db redis backend nginx

## [Docker] 🚀 Start core + AI services (ollama + infinity + meilisearch, ~5GB)
up-ai: check-dockerfiles
	docker compose up -d --build --remove-orphans db redis backend nginx ollama infinity meilisearch

## [Docker] 🚀 Start core + AI + admin (日常开发, ~5.2GB)
up-dev: check-dockerfiles
	docker compose up -d --build --remove-orphans db redis backend nginx ollama infinity meilisearch admin-next

## [Docker] 🚀 Start core + blog (blog 管理, ~1.6GB)
up-blog: check-dockerfiles
	docker compose up -d --build --remove-orphans db redis backend nginx admin-blog frontend-blog

## [Docker] 🚀 Start all services (全开, ~5.8GB)
up-all: check-dockerfiles
	docker compose up -d --build --remove-orphans

## [Docker] ⏹️ Stop memory-heavy services (省内存模式)
stop-ai:
	docker compose stop ollama infinity meilisearch

stop-blog:
	docker compose stop admin-blog frontend-blog

stop-all-extra:
	docker compose stop ollama infinity meilisearch admin-next admin-blog frontend-blog

## [Docker] ▶️ Start individual services
start-ollama:
	docker compose up -d ollama

start-infinity:
	docker compose up -d infinity

start-meilisearch:
	docker compose up -d meilisearch

start-blog:
	docker compose up -d admin-blog frontend-blog

start-unstructured:
	docker compose up -d unstructured

stop-unstructured:
	docker compose stop unstructured

unstructured-status:
	@echo "📋 Unstructured container status:"
	docker compose ps unstructured
	@echo ""
	@echo "  启动: make start-unstructured"
	@echo "  停止: make stop-unstructured"
	@echo "  API:  http://localhost:8000"

## [Docker] 📊 Show memory usage of running containers
mem:
	docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}"

## [Docker] 🛑 Stop all containers (auto-removes orphans)
down:
	docker compose down --remove-orphans

## [Docker] 🔄 Restart all services
restart:
	docker compose restart

## [Docker] Rebuild images (use after changing package.json or Dockerfile)
build: check-dockerfiles
	docker compose build --no-cache

## [Docker] 📋 View running containers
ps:
	docker compose ps

## [Docker] 📝 View logs for all services (Ctrl+C to exit)
logs:
	docker compose logs -f

## [Docker] 📝 View logs for a specific service (usage: make log s=backend)
log:
	docker compose logs -f $(s)

# ──────────────────────────────────────────
# Danger Zone (Cleanup & Reset)
# ──────────────────────────────────────────

## [Cleanup] 🧹 Remove containers & unused images (keeps DB data!)
clean:
	docker compose down --remove-orphans
	docker image prune -f
	@echo "✓ Environment cleaned (DB and Redis data preserved)"

## [Nuke] ⚠️ Full reset: removes everything including DB + cache volumes (use with care!)
wipe:
	docker compose down -v --remove-orphans
	docker image prune -a -f
	@echo "☠️  All containers, networks, images & volumes destroyed!"

# ──────────────────────────────────────────
# Local Frontend Dev (faster HMR than Docker)
# ──────────────────────────────────────────

## [Frontend] Start Admin panel (requires make up-infra first)
dev-admin:
	yarn workspace @lucky/admin-next dev

## [Frontend] Start Blog frontend (uses Turbopack, requires make up-infra first)
dev-blog:
	cd apps/frontend-blog && PORT=4002 yarn dev --turbopack -p 4002

## [Frontend] 🧹 Clear blog dev cache & restart (clears Turbopack persistent cache, fixes Hydration Error)
dev-blog-clean:
	@echo "→ Killing blog dev server (port 4002)..."
	@lsof -ti:4002 | xargs kill -9 2>/dev/null || echo "  ⏭️  No process on port 4002"
	@sleep 1
	@echo "→ Clearing .next .turbo cache..."
	@rm -rf apps/frontend-blog/.next apps/frontend-blog/.turbo
	@echo "→ Restarting dev server..."
	@cd apps/frontend-blog && PORT=4002 yarn dev --turbopack -p 4002

# ──────────────────────────────────────────
# Tunnel (Cloudflare Public Tunnel)
# ──────────────────────────────────────────

## [Tunnel] 🚇 Start Cloudflare Tunnel (exposes local API at dev-api.joyminis.com)
tunnel:
	cloudflared tunnel --config cloudflared.yml run lucky-nest-monorepo

## [Tunnel] 🛑 Stop Cloudflare Tunnel
tunnel-kill:
	-pkill cloudflared 2>/dev/null || killall cloudflared 2>/dev/null || echo "⚠️  cloudflared not running"

## [Tunnel] 🔄 Restart Cloudflare Tunnel (kill + start, uses latest cloudflared.yml)
tunnel-restart: tunnel-kill
	cloudflared tunnel --config cloudflared.yml run lucky-nest-monorepo &

## [DNS] 🧹 Flush macOS DNS cache (run after adding new domains, fixes DNS_PROBE_FINISHED_NXDOMAIN)
dns-flush:
	sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder
	@echo "✓ macOS DNS cache cleared"

# ──────────────────────────────────────────
# Database / Backend Dev Tools
# ──────────────────────────────────────────

## [API] Enter backend container shell
exec-api:
	docker compose exec backend sh

## [DB] Run Prisma migration (sync database schema)
migrate:
	docker compose exec backend ./node_modules/.bin/prisma migrate dev --schema=apps/api/prisma/schema.prisma

## [DB] Reset DB & run seed (⚠️ will wipe existing data)
seed:
	docker compose exec backend yarn workspace @lucky/api seed

## [DB] Open Prisma Studio (web-based DB browser)
prisma-studio:
	docker compose exec backend ./node_modules/.bin/prisma studio --schema=apps/api/prisma/schema.prisma

## [DB] Regenerate Prisma Client (after schema changes)
prisma-generate:
	docker compose exec backend ./node_modules/.bin/prisma generate --schema=apps/api/prisma/schema.prisma

# ──────────────────────────────────────────
# Ollama (Local LLM Service)
# ──────────────────────────────────────────

## [Ollama] 🚀 Start Ollama service (macOS via brew)
ollama-start:
	brew services start ollama

## [Ollama] 🛑 Stop Ollama service
ollama-stop:
	brew services stop ollama

## [Ollama] 🔄 Restart Ollama service
ollama-restart:
	brew services restart ollama

## [Ollama] 📋 Check Ollama service status
ollama-status:
	brew services info ollama

## [Ollama] 📝 View Ollama logs (tail -f)
ollama-logs:
	@echo "→ Viewing Ollama logs (Ctrl+C to exit)..."
	@if [ -f ~/.ollama/ollama.log ]; then \
		tail -f ~/.ollama/ollama.log; \
	else \
		echo "  ❌ Log file not found at ~/.ollama/ollama.log"; \
		echo "  Try: make ollama-status"; \
	fi

## [Ollama] 📦 Pull recommended models (chat + embedding)
ollama-pull:
	@echo "→ Pulling recommended models..."
	ollama pull qwen3.5:0.8b
	ollama pull mxbai-embed-large
	@echo "✓ Done! Run 'make ollama-list' to verify"

## [Ollama] 📋 List downloaded models
ollama-list:
	ollama list

## [Ollama] 🧠 Show currently loaded models (running in memory)
ollama-ps:
	ollama ps

## [Ollama] 💬 Run a model interactively (usage: make ollama-run m=qwen3.5:0.8b)
ollama-run:
	@if [ -z "$(m)" ]; then \
		echo "  Usage: make ollama-run m=qwen3.5:0.8b"; \
		echo "  Available models: make ollama-list"; \
		exit 1; \
	fi
	ollama run $(m)

## [Ollama] 🗑️ Remove a model (usage: make ollama-rm m=qwen3.5:0.8b)
ollama-rm:
	@if [ -z "$(m)" ]; then \
		echo "  Usage: make ollama-rm m=qwen3.5:0.8b"; \
		echo "  Current models: make ollama-list"; \
		exit 1; \
	fi
	@read -p "  Remove model '$(m)'? (y/N): " yn; \
	if [ "$$yn" != "y" ] && [ "$$yn" != "Y" ]; then \
		echo "  ❌ Cancelled"; \
		exit 1; \
	fi
	ollama rm $(m)

## [Ollama] 🌐 REST API health check (verify Ollama is responding)
ollama-health:
	@echo "→ Checking /api/tags (Ollama API)..."
	@curl -s http://localhost:11434/api/tags | head -c 200
	@echo ""
	@echo "→ Checking /api/version..."
	@curl -s http://localhost:11434/api/version
	@echo ""

## [Ollama] 🧪 Run quick inference test (verify a model works)
ollama-test:
	@if [ -z "$(m)" ]; then \
		echo "  → Using default model: qwen3.5:0.8b"; \
		$(MAKE) ollama-test-internal m=qwen3.5:0.8b; \
	else \
		$(MAKE) ollama-test-internal m=$(m); \
	fi

ollama-test-internal:
	@echo "→ Testing model: $(m)"
	@echo "   Prompt: 'Hello, respond with OK only'"
	@echo "───────────────────────────────────────────"
	@curl -s http://localhost:11434/api/generate \
		-d '{"model": "$(m)", "prompt": "Hello, respond with OK only", "stream": false}' \
		| python3 -c "import sys,json; print(json.load(sys.stdin).get('response','ERROR'))" 2>/dev/null || \
		curl -s http://localhost:11434/api/generate \
		-d "{\"model\": \"$(m)\", \"prompt\": \"Hello, respond with OK only\", \"stream\": false}" \
		| grep -o '"response":"[^"]*"' | head -1
	@echo "───────────────────────────────────────────"
	@echo "✓ Test complete"

# ──────────────────────────────────────────
# Code Quality (lint / fix / audit)
# ──────────────────────────────────────────

## [Quality] 🔍 Run full lint (same as CI, checks ERROR-level issues)
check:
	yarn turbo run lint

## [Quality] 🧪 Run full TypeScript strict type-check (tsc --noEmit, covers all workspaces)
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

## [Quality] 🎨 Run Prettier formatting only (no ESLint fix)
format:
	yarn format

## [Quality] 🔧 Auto-fix fixable issues (prettier + eslint --fix)
fix:
	@echo "==> Prettier: formatting all files..."
	$(MAKE) format
	@echo ""
	@echo "==> ESLint: auto-fixing what's fixable..."
	-yarn workspace @lucky/api lint --fix 2>/dev/null
	-yarn workspace @lucky/frontend-blog lint --fix 2>/dev/null
	-yarn workspace @lucky/admin-next lint --fix 2>/dev/null
	@echo ""
	@echo "✅ Auto-fix complete. Remaining issues (if any) require manual fixes."
	@echo "   Run 'make check' to verify."

## [Quality] 📊 Categorized warning report by severity
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
# Production Deployment (VPS)
# ──────────────────────────────────────────
# All deploy/rollback commands will prompt for VPS_IP interactively,
# or you can preset it: make deploy VPS_IP=1.2.3.4
# ──────────────────────────────────────────

## [Deploy] 🚀 Full deployment (backend + frontend)
deploy:
	bash deploy/deploy.sh

## [Deploy] Backend only
deploy-backend:
	bash deploy/deploy.sh --backend

## [Deploy] Frontend only (admin-next)
deploy-admin:
	bash deploy/deploy.sh --admin

## [Deploy] Skip build, just restart services
deploy-quick:
	bash deploy/deploy.sh --quick

## [Deploy] Sync config files only
deploy-sync:
	bash deploy/deploy.sh --sync

## [Rollback] 🔙 Roll back containers (backend + frontend)
rollback:
	bash deploy/rollback.sh

## [Rollback] Backend only
rollback-backend:
	bash deploy/rollback.sh --backend

## [Rollback] ⚠️ Restore DB backup (high risk!)
rollback-db:
	bash deploy/rollback.sh --db

## [Cloudflare] 🔁 Switch admin DNS to Cloudflare Workers (dry-run)
switch-admin-dns:
	bash deploy/switch-admin-cloudflare.sh

## [Cloudflare] 🔁 Switch admin DNS back to VPS (dry-run)
rollback-admin-dns:
	bash deploy/cloudflare-rollback.sh

## [Cloudflare] ✅ Verify blog frontend cache status (Cloudflare Workers)
verify-blog-cache:
	bash deploy/verify-blog-cache.sh

# ──────────────────────────────────────────
# Blog Docs Publishing
# ──────────────────────────────────────────

## [Blog Doc] 📝 Preview blog articles to be published (dry-run, no actual creation)
publish-blog-docs-dry-run:
	DRY_RUN=true PUBLISH_STATUS=$(PUBLISH_STATUS) \
	API_URL=$(API_URL) \
	SOURCE_DIR=$(SOURCE_DIR) \
	npx tsx scripts/batch-import-blog-articles.ts

## [Blog Doc] 🚀 Publish articles from docs/blog/articles/ to the blog system
## Usage: make publish-blog-docs API_URL=https://api.joyminis.com/api
##       Defaults to DRAFT; set PUBLISH_STATUS=PUBLISHED to publish immediately
publish-blog-docs:
	@if [ -z "$(API_URL)" ]; then \
		echo ""; \
		echo "  ❌ Please provide API_URL"; \
		echo "  Usage: make publish-blog-docs API_URL=https://api.joyminis.com/api"; \
		echo "         make publish-blog-docs API_URL=http://localhost:3000/api PUBLISH_STATUS=DRAFT"; \
		echo ""; \
		exit 1; \
	fi
	API_URL=$(API_URL) \
	PUBLISH_STATUS=$(PUBLISH_STATUS) \
	SOURCE_DIR=$(SOURCE_DIR) \
	npx tsx scripts/batch-import-blog-articles.ts

# ──────────────────────────────────────────
# Production Logs (VPS)
# ──────────────────────────────────────────
# These commands SSH into the VPS to view production container logs.
# The terminal will prompt for VPS_IP interactively, or preset it:
#   make logs-prod VPS_IP=1.2.3.4
# ──────────────────────────────────────────

## [Logs] 📝 View all VPS service logs (Ctrl+C to exit, like tail -f)
logs-prod:
	@if [ -z "$(VPS_IP)" ]; then \
		read -p "VPS IP: " VPS_IP; \
		ssh root@$$VPS_IP 'docker compose -f /opt/lucky/compose.prod.yml logs -f'; \
	else \
		ssh root@$(VPS_IP) 'docker compose -f /opt/lucky/compose.prod.yml logs -f'; \
	fi

## [Logs] 🔙 View backend logs (Ctrl+C to exit)
logs-backend:
	@if [ -z "$(VPS_IP)" ]; then \
		read -p "VPS IP: " VPS_IP; \
		ssh root@$$VPS_IP 'docker logs -f --tail=100 lucky-backend-prod'; \
	else \
		ssh root@$(VPS_IP) 'docker logs -f --tail=100 lucky-backend-prod'; \
	fi

## [Logs] 🌐 View Nginx logs (last 50 lines)
logs-nginx:
	@if [ -z "$(VPS_IP)" ]; then \
		read -p "VPS IP: " VPS_IP; \
		ssh root@$$VPS_IP 'docker logs --tail=50 lucky-nginx-prod'; \
	else \
		ssh root@$(VPS_IP) 'docker logs --tail=50 lucky-nginx-prod'; \
	fi

## [Logs] 🗄️ View DB logs (last 50 lines)
logs-db:
	@if [ -z "$(VPS_IP)" ]; then \
		read -p "VPS IP: " VPS_IP; \
		ssh root@$$VPS_IP 'docker logs --tail=50 lucky-db-prod'; \
	else \
		ssh root@$(VPS_IP) 'docker logs --tail=50 lucky-db-prod'; \
	fi

## [Logs] 📞 View TURN server logs (last 100 lines)
logs-turn:
	@if [ -z "$(VPS_IP)" ]; then \
		read -p "VPS IP: " VPS_IP; \
		ssh root@$$VPS_IP 'tail -n 100 /var/log/turnserver.log'; \
	else \
		ssh root@$(VPS_IP) 'tail -n 100 /var/log/turnserver.log'; \
	fi

# ──────────────────────────────────────────
# AWS ECS (Production Ops)
# ──────────────────────────────────────────
# These commands operate the frontend-blog service on AWS ECS Fargate.
# Requires AWS CLI credentials (IAM user).
# ──────────────────────────────────────────

CLUSTER := tarsier-labs-cluster
SERVICE := tarsier-labs-service
CONTAINER := frontend-blog
AWS_REGION := ap-southeast-1

## [AWS] 🚀 Run load test (hey -n 100000 -c 50, simulates 50 concurrent × 100K requests)
aws-load-test:
	@echo "→ Starting load test: 100K requests × 50 concurrency"
	@echo "   URL: $(URL)"
	@echo "   In another terminal, run 'make aws-check-scaling' to watch scaling"
	@echo ""
	@if [ -z "$(URL)" ]; then \
		echo "  ❌ Please provide URL"; \
		echo "  Usage: make aws-load-test URL=https://tarsier.joyminis.com/zh/"; \
		exit 1; \
	fi
	hey -n 100000 -c 50 $(URL)

## [AWS] 📊 Watch ECS task count (refreshes every 5s)
aws-check-scaling:
	watch -n 5 AWS_PAGER="" aws ecs describe-services \
		--cluster $(CLUSTER) \
		--services $(SERVICE) \
		--query "services[0].runningCount"

## [AWS] 🔍 Check Auto Scaling trigger history (verify scaling worked)
aws-scaling-activities:
	AWS_PAGER="" aws application-autoscaling describe-scaling-activities \
		--service-namespace ecs \
		--resource-id service/$(CLUSTER)/$(SERVICE)

## [AWS] 📈 View ECS service CPU utilization (last 1 hour)
aws-check-cpu:
	@echo "→ Checking $(SERVICE) CPU utilization (last 1h)..."
	AWS_PAGER="" aws cloudwatch get-metric-statistics \
		--namespace AWS/ECS \
		--metric-name CPUUtilization \
		--dimensions Name=ClusterName,Value=$(CLUSTER) Name=ServiceName,Value=$(SERVICE) \
		--start-time "$(shell date -u -v-1H '+%Y-%m-%dT%H:%M:%SZ')" \
		--end-time "$(shell date -u '+%Y-%m-%dT%H:%M:%SZ')" \
		--period 60 \
		--statistics Average \
		--query "Datapoints[*].[Timestamp,Average]" \
		--output table

## [AWS] 🔄 Force ECS rolling update (pull latest image & restart containers)
aws-force-deploy:
	@echo "→ Force-triggering $(SERVICE) rolling update..."
	AWS_PAGER="" aws ecs update-service \
		--cluster $(CLUSTER) \
		--service $(SERVICE) \
		--force-new-deployment

## [AWS] 📝 Tail ECS container CloudWatch logs (last 100, follow mode)
aws-ecs-logs:
	@echo "→ Fetching latest task ID..."
	$(eval TASK := $(shell AWS_PAGER="" aws ecs list-tasks --cluster $(CLUSTER) --service-name $(SERVICE) --query "taskArns[0]" --output text 2>/dev/null))
	@if [ "$(TASK)" = "None" ] || [ -z "$(TASK)" ]; then \
		echo "  ❌ No running task found"; \
		exit 1; \
	fi
	@echo "   Task: $(TASK)"
	AWS_PAGER="" aws logs tail /ecs/$(CONTAINER) --follow --since 5m

## [AWS] 🔑 SSH into a running ECS container (requires ECS Exec enabled)
aws-ecs-exec:
	@echo "→ Fetching latest task ID..."
	$(eval TASK := $(shell AWS_PAGER="" aws ecs list-tasks --cluster $(CLUSTER) --service-name $(SERVICE) --query "taskArns[0]" --output text 2>/dev/null))
	@if [ "$(TASK)" = "None" ] || [ -z "$(TASK)" ]; then \
		echo "  ❌ No running task found"; \
		exit 1; \
	fi
	@echo "   Task: $(TASK)"
	AWS_PAGER="" aws ecs execute-command \
		--cluster $(CLUSTER) \
		--task $(TASK) \
		--container $(CONTAINER) \
		--command "/bin/sh" \
		--interactive

## [AWS] 🛑 Stop all ECS containers (set desiredCount=0, stops Fargate billing)
aws-stop-all:
	@echo "→ Stopping $(SERVICE)..."
	@echo "  ⚠️  Setting desiredCount=0 — all containers will be stopped"
	@read -p "  Confirm? (y/N): " yn; \
	if [ "$$yn" != "y" ] && [ "$$yn" != "Y" ]; then \
		echo "  ❌ Cancelled"; \
		exit 1; \
	fi
	AWS_PAGER="" aws ecs update-service \
		--cluster $(CLUSTER) \
		--service $(SERVICE) \
		--desired-count 0
	@echo ""
	@echo "  ✅ All containers stopped. Fargate billing stopped."
	@echo "  ⚠️  ALB (~$$16.50/mo) still exists — can't delete via CLI, need to remove CDK stack manually."
	@echo "  👉 Restart: make aws-start-all"

## [AWS] ▶️ Restore ECS containers (set desiredCount=1)
aws-start-all:
	@echo "→ Restoring $(SERVICE)..."
	AWS_PAGER="" aws ecs update-service \
		--cluster $(CLUSTER) \
		--service $(SERVICE) \
		--desired-count 1
	@echo ""
	@echo "  ✅ desiredCount=1, containers will start in a few seconds"
	@echo "  👉 Monitor status: make aws-check-scaling"

## [AWS] 💰 One-click AWS cost check — flags any potentially wasteful resources
aws-cost-check:
	@echo ""
	@echo "┌─────────────────────────────────────────┐"
	@echo "│   💰 AWS Cost Check                      │"
	@echo "└─────────────────────────────────────────┘"
	@echo ""
	@echo "━━━ 🚢 ECS Services ━━━━━━━━━━━━━━━━━━━━━━"
	@echo "→ Checking $(SERVICE)..."
	@AWS_PAGER="" aws ecs describe-services --cluster $(CLUSTER) --services $(SERVICE) \
		--query "services[0].{running: runningCount, desired: desiredCount, status: status}" \
		--output table 2>/dev/null; \
		rc=$$?; \
		if [ $$rc -ne 0 ]; then \
			echo "  ⚠️  API call failed — check AWS CLI config"; \
		fi
	@echo "→ Checking for extra ECS Services..."
	@EXTRA=$$(aws ecs list-services --cluster $(CLUSTER) --query "serviceArns[?contains(@, '$(SERVICE)')==\`false\`]" --output text 2>/dev/null); \
		if [ -n "$$EXTRA" ] && [ "$$EXTRA" != "None" ]; then \
			echo "  ⚠️  Unexpected Service found:"; \
			echo "     $$EXTRA"; \
		else \
			echo "  ✅ No extra services"; \
		fi
	@echo ""
	@echo "━━━ 🌐 Load Balancers ━━━━━━━━━━━━━━━━━━━"
	@ALB_COUNT=$$(aws elbv2 describe-load-balancers --query "length(LoadBalancers)" --output text 2>/dev/null); \
		if [ "$$ALB_COUNT" = "0" ] || [ -z "$$ALB_COUNT" ]; then \
			echo "  ⚠️  No ALB found — may have been deleted accidentally"; \
		elif [ "$$ALB_COUNT" = "1" ]; then \
			echo "  ✅ 1 ALB — as expected"; \
		else \
			echo "  ⚠️  $$ALB_COUNT ALBs found! Each ~$$22/mo"; \
			AWS_PAGER="" aws elbv2 describe-load-balancers --query "LoadBalancers[*].{name: LoadBalancerName, dns: DNSName}" --output table; \
		fi
	@echo ""
	@echo "━━━ 🖥️ EC2 Instances ━━━━━━━━━━━━━━━━━━━━"
	@EC2_COUNT=$$(aws ec2 describe-instances --filters Name=instance-state-name,Values=running --query "length(Reservations[*].Instances[*])" --output text 2>/dev/null); \
		if [ -z "$$EC2_COUNT" ] || [ "$$EC2_COUNT" = "0" ]; then \
			echo "  ✅ 0 EC2 instances — Fargate doesn't need them, saves money"; \
		else \
			echo "  ⚠️  $$EC2_COUNT EC2 instances running! Fargate doesn't need these"; \
			AWS_PAGER="" aws ec2 describe-instances --filters Name=instance-state-name,Values=running --query "Reservations[*].Instances[*].{id: InstanceId, type: InstanceType, launch: LaunchTime}" --output table; \
		fi
	@echo ""
	@echo "━━━ 💰 Monthly Cost Estimate ━━━━━━━━━━━━━━━"
	@echo '  ECS Fargate (1×1024/2048): ~$$18/mo'
	@echo '  ALB:                     ~$$16.50/mo'
	@echo '  ─────────────────────────────────'
	@echo '  Total:                   ~$$34-35/mo'
	@echo ""
	@echo "📋 Conclusion:"
	@ALB_COUNT=$$(aws elbv2 describe-load-balancers --query "length(LoadBalancers)" --output text 2>/dev/null); \
	EC2_COUNT=$$(aws ec2 describe-instances --filters Name=instance-state-name,Values=running --query "length(Reservations[*].Instances[*])" --output text 2>/dev/null); \
	EXTRA=$$(aws ecs list-services --cluster $(CLUSTER) --query "serviceArns[?contains(@, '$(SERVICE)')==\`false\`]" --output text 2>/dev/null); \
	HAS_WARN=0; \
	if [ -n "$$EXTRA" ] && [ "$$EXTRA" != "None" ]; then HAS_WARN=1; fi; \
	if [ "$$ALB_COUNT" != "1" ] && [ -n "$$ALB_COUNT" ]; then HAS_WARN=1; fi; \
	if [ "$$EC2_COUNT" != "0" ] && [ -n "$$EC2_COUNT" ]; then HAS_WARN=1; fi; \
	if [ $$HAS_WARN -eq 1 ]; then \
		echo "  ⚠️  Suspicious resources found — check lines marked ⚠️ above"; \
	else \
		echo "  ✅ All clear, no unexpected spending"; \
	fi
	@echo ""

# ──────────────────────────────────────────
# AWS S3→R2 Sync (DLQ Operations)
# ──────────────────────────────────────────

## [AWS-Sync] 📋 Check S3→R2 Sync DLQ for failed file records
aws-sync-dlq-check:
	@echo "→ Checking S3→R2 Sync DLQ for failed files..."
	@DLQ_URL=$$(AWS_PAGER="" aws sqs get-queue-url --queue-name s3-to-r2-sync-dlq --query "QueueUrl" --output text --region $(AWS_REGION) 2>/dev/null); \
	if [ -z "$$DLQ_URL" ]; then \
		echo "  ❌ DLQ not found. Has 'cdk deploy' been run?"; \
		exit 1; \
	fi; \
	echo "  Queue: $$DLQ_URL"; \
	echo "→ Receiving up to 10 messages..."; \
	AWS_PAGER="" aws sqs receive-message \
		--queue-url "$$DLQ_URL" \
		--max-number-of-messages 10 \
		--region $(AWS_REGION) \
		--query "Messages[*].Body" \
		--output json; \
	MSG_COUNT=$$(AWS_PAGER="" aws sqs receive-message \
		--queue-url "$$DLQ_URL" \
		--max-number-of-messages 10 \
		--region $(AWS_REGION) \
		--query "length(Messages)" \
		--output text 2>/dev/null); \
	if [ "$$MSG_COUNT" = "None" ] || [ -z "$$MSG_COUNT" ] || [ "$$MSG_COUNT" = "0" ]; then \
		echo "  ✅ DLQ is empty — no recent failures"; \
	else \
		echo "  ⚠️  $$MSG_COUNT failure(s) found — inspect above"; \
		echo "  👉 After reviewing, purge: make aws-sync-dlq-purge"; \
	fi

## [AWS-Sync] 🧹 Purge all messages from S3→R2 Sync DLQ (after reviewing failures)
aws-sync-dlq-purge:
	@echo "⚠️  This will delete ALL messages from the DLQ permanently!"
	@read -p "  Confirm? (y/N): " yn; \
	if [ "$$yn" != "y" ] && [ "$$yn" != "Y" ]; then \
		echo "  ❌ Cancelled"; \
		exit 1; \
	fi; \
	DLQ_URL=$$(AWS_PAGER="" aws sqs get-queue-url --queue-name s3-to-r2-sync-dlq --query "QueueUrl" --output text --region $(AWS_REGION) 2>/dev/null); \
	if [ -z "$$DLQ_URL" ]; then \
		echo "  ❌ DLQ not found"; \
		exit 1; \
	fi; \
	AWS_PAGER="" aws sqs purge-queue --queue-url "$$DLQ_URL" --region $(AWS_REGION); \
	echo "✅ DLQ purged successfully"

# ──────────────────────────────────────────
# AWS CDK Infra (S3-R2 Sync)
# ──────────────────────────────────────────

## [AWS-CDK] 🏗️ Deploy CDK stack (local — reads .env.prod for email)
aws-infra-deploy:
	@echo "→ Deploying CDK stack..."
	cd infra && npx cdk deploy --app "npx ts-node bin/infra.ts" --require-approval never

## [AWS-CDK] 🔍 Show CDK diff (preview changes before deploy)
aws-infra-diff:
	@echo "→ CDK diff..."
	cd infra && npx cdk diff --app "npx ts-node bin/infra.ts"

## [AWS-CDK] 🗑️ Destroy CDK stack (DANGER — deletes all resources)
aws-infra-destroy:
	@echo "⚠️  This will DESTROY the entire CDK stack!"
	@read -p "  Are you sure? (type 'destroy' to confirm): " confirm; \
	if [ "$$confirm" != "destroy" ]; then \
		echo "❌ Cancelled"; \
		exit 1; \
	fi; \
	cd infra && npx cdk destroy --app "npx ts-node bin/infra.ts" --force

# ──────────────────────────────────────────
# Help & Interactive Menu
# ──────────────────────────────────────────

## [Help] Show this help message (description + actual command name)
help:
	@echo ""
	@echo "  🚀 Lucky Nest — Developer Toolbox"
	@echo "  ─────────────────────────────────────────"
	@awk '/^## /{desc=substr($$0,4); getline; if (/:/ && !/^define/) { sub(/:.*/,""); printf "  \033[1;36m%-22s\033[0m  %s\n", "make " $$0, desc } else { printf "  %s\n", desc } }' Makefile
	@echo ""
	@echo "  💡 For VPS deploy/log commands, you'll be prompted for VPS_IP interactively"
	@echo "     or preset it: make deploy VPS_IP=1.2.3.4"
	@echo ""
	@echo "  💡 Try 'make menu' for interactive command picker (needs: brew install fzf)"
	@echo ""

## [Menu] 🎯 Interactive command picker (requires fzf — brew install fzf)
menu:
	@if ! command -v fzf >/dev/null 2>&1; then \
		echo ""; \
		echo "  ❌ fzf not found — install it first:"; \
		echo ""; \
		echo "     brew install fzf"; \
		echo "     (fzf will also install key bindings and fuzzy completion)"; \
		echo ""; \
		exit 1; \
	fi; \
	CMD=$$(awk '/^## /{desc=substr($$0,4); getline; if (/:/ && !/^define/) { sub(/:.*/,""); printf "%-55s → make %s\n", desc, $$0 } }' Makefile | \
		fzf --prompt="🎯 Select a make command > " \
			--height=60% --layout=reverse --border \
			--preview='echo "▶ {}"' | \
		sed 's/.*→ make //'); \
	if [ -n "$$CMD" ]; then \
		echo ""; \
		echo "  ▶ Running: make $$CMD"; \
		echo "  ─────────────────────────────────────────"; \
		$(MAKE) $$CMD; \
	fi
