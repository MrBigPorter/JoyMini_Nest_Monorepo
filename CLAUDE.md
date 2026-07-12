# JoyMini Nest Monorepo

## Stack

- **Backend**: NestJS + Prisma (PostgreSQL) + Redis + LangGraph.js
- **Frontend**: Next.js (`apps/frontend-blog/`, `apps/admin-next/`)
- **Mobile**: Flutter at `/Users/porter/Developer/JoyMini_Flutter_App/` (separate project)
- **Shared**: `packages/ui/` (shadcn/ui), `packages/shared/` (types)
- **Docker**: Colima (lightweight VM, replaces OrbStack) — disk on MySSD

## Project Structure

```
apps/api/                    — NestJS backend (main workspace)
apps/api/src/
  admin/                     — Admin API modules
  client/
    ai-customer/             — AI customer service (LangGraph)
      graph/                 — LangGraph state / nodes / tools
      dto/                   — SSE request DTO
      knowledge/             — RAG retrieval + prompt resolver
    auth/                    — Auth (JWT/login)
  common/                    — Shared guards, decorators, Redis, Prisma
apps/frontend-blog/          — Next.js blog frontend
apps/admin-next/             — Next.js admin dashboard
nginx/conf.d/                — Nginx configs (SSE proxy_buffering off)
docs/AI-joymini/             — Feature specs & architecture docs
```

## Key Architecture

- **LangGraph**: StateGraph with orchestrator node, 9 intent routing via pgvector
- **Orchestrator node**: Score Gap Check (MIN_SCORE=0.65, SCORE_GAP=0.15), close-contenders truncation
- **RAG**: 4-tier retrieval + Meilisearch + Infinity (embedding + reranker) + reranker
- **Infinity**: Unified embedding (bge-m3) + reranker (bge-reranker-v2-m3), replaced Ollama for embedding
- **Chat LLM**: DeepSeek API (cloud), no local LLM needed
- **SSE**: 5-layer Redis rate limiting + circuit breaker + streamEvents bridge
- **Auth**: JWT guards (JwtAuthGuard, OptionalJwtGuard)
- **MemorySaver** (in-memory) — PG Checkpointer not yet implemented

## Commands

```bash
# Start/stop Colima
colima start --memory 4 --cpu 4     # 首次
colima start                         # 重启电脑后
colima stop                          # 用完关掉（0 内存占用）

# Start by phase (按内存从小到大)
make up-db          # DB + redis (~500MB)    跑迁移、本地后端
make up-backend     # + backend (~1.5GB)      开发 API
make up-ai          # + AI 服务 (~4GB)        测试 AI 对话

# Start/stop services
make start-db / start-redis / start-backend / start-infinity
make stop-db / stop-redis / stop-backend / stop-infinity
make start-frontend / stop-frontend   # admin + blog + nginx
make stop-ai      # 停 AI 服务（省内存）
make stop-extra   # 停全部非核心

# Memory
make mem      # 查看容器内存占用

# Prisma
make migrate-local     # 本地跑迁移（先 make up-db）
make prisma-studio-local  # 本地 Prisma Studio

# Local dev
make dev-api          # 本地启动后端（不吃 Docker 内存）
yarn workspace @lucky/admin-next dev   # admin 前端

# Type-check
yarn workspace @lucky/api tsc --noEmit --pretty
```

## NestJS Patterns

- Controller: only I/O, validate with DTO, call service
- Service: business logic, throw BizException
- Guards: JwtAuthGuard + RolesGuard for auth
- DTO: `class-validator` decorators for validation
- Modules: register providers, exports, imports
- Decorators: `@CurrentUserId()`, `@RealIP()`, `@CurrentDevice()`

## Docs

- `docs/current-task.md` — current task context
- `docs/coding-standards.md` — 9-dimension code quality checklist
- `docs/AI-joymini/` — all feature specs (numbered, ordered)

## Rules (mandatory before coding)

1. Read `docs/current-task.md` — confirm what to work on
2. Read `docs/coding-standards.md` — check 9 dimensions (boundary, test, UX, perf, maintainability, security, observability, resilience, modularity)
3. Check `docs/AI-joymini/` for relevant specs — don't implement without a spec
4. Read 2 existing files in the same area to match style and patterns
5. Run type check before marking done (`yarn workspace @lucky/api tsc --noEmit --pretty` for Nest, `dart analyze` for Flutter)
