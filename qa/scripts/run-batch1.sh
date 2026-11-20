#!/usr/bin/env bash
# Batch 1 QA runner — isolated Postgres/Redis, real API, real admin, no mocks.
#
#   bash qa/scripts/run-batch1.sh            # full run
#   bash qa/scripts/run-batch1.sh --stop     # stop QA processes only
#
# Ports: Postgres 5433, Redis 6382, API 4102, Admin 4101, Judge stub 4199.
# 4100 is avoided because other local tooling may already own it; the wiring is
# identical apart from the port (documented in qa/reports/batch-1.md).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

QA_ENV="$REPO_ROOT/qa/.env.qa"
LOG_DIR="$REPO_ROOT/qa/logs"
mkdir -p "$LOG_DIR"

stop_all() {
  for name in admin api judge-stub; do
    pid_file="$LOG_DIR/$name.pid"
    if [[ -f "$pid_file" ]]; then
      pid="$(cat "$pid_file")"
      kill "$pid" 2>/dev/null || true
      rm -f "$pid_file"
    fi
  done
}

if [[ "${1:-}" == "--stop" ]]; then
  stop_all
  docker compose -f qa/compose.qa.yml down
  exit 0
fi

# ---------- 1. data services ----------
if docker inspect lucky-db-qa >/dev/null 2>&1; then
  # Containers may have been started manually earlier; just ensure they run.
  docker start lucky-db-qa lucky-redis-qa >/dev/null 2>&1 || true
else
  docker compose -f qa/compose.qa.yml up -d
fi
printf 'waiting for QA Postgres'
for _ in $(seq 1 60); do
  if docker exec lucky-db-qa pg_isready -U lucky -d joy_mini_qa >/dev/null 2>&1; then
    echo ' ok'
    break
  fi
  printf '.'
  sleep 1
done
docker exec lucky-redis-qa redis-cli ping >/dev/null

# ---------- 2. migrations + seed (frozen commit only) ----------
set -a
# shellcheck disable=SC1090
. "$QA_ENV"
set +a
cd "$REPO_ROOT/apps/api"
npx prisma migrate deploy --schema prisma/schema.prisma
cd "$REPO_ROOT"
npx tsx qa/seed/batch1.ts

# ---------- 3. judge stub ----------
if [[ ! -f "$LOG_DIR/judge-stub.pid" ]] || ! kill -0 "$(cat "$LOG_DIR/judge-stub.pid")" 2>/dev/null; then
  nohup node qa/scripts/judge-stub.mjs > "$LOG_DIR/judge-stub.log" 2>&1 &
  echo $! > "$LOG_DIR/judge-stub.pid"
fi
for _ in $(seq 1 30); do
  curl -sf http://127.0.0.1:4199/health >/dev/null && break
  sleep 0.5
done

# ---------- 4. API ----------
if [[ ! -f "$LOG_DIR/api.pid" ]] || ! kill -0 "$(cat "$LOG_DIR/api.pid")" 2>/dev/null; then
  ( cd "$REPO_ROOT/apps/api" && nohup ../../node_modules/.bin/nest start > "$LOG_DIR/api.log" 2>&1 & echo $! > "$LOG_DIR/api.pid" )
fi
printf 'waiting for QA API'
for _ in $(seq 1 120); do
  if curl -sf http://127.0.0.1:4102/api/v1/health >/dev/null 2>&1; then
    echo ' ok'
    break
  fi
  printf '.'
  sleep 1
done

# ---------- 5. API contract suite ----------
yarn workspace @lucky/api test:e2e:ai-ops

# ---------- 6. admin dev server ----------
if [[ ! -f "$LOG_DIR/admin.pid" ]] || ! kill -0 "$(cat "$LOG_DIR/admin.pid")" 2>/dev/null; then
  ( cd "$REPO_ROOT/apps/admin-next" && \
    env -u NODE_ENV \
      NEXT_TELEMETRY_DISABLED=1 \
      NEXT_PUBLIC_API_BASE_URL='http://127.0.0.1:4102/api' \
      INTERNAL_API_URL='http://127.0.0.1:4102/api' \
      API_BASE_URL='http://127.0.0.1:4102/api' \
      nohup ../../node_modules/.bin/next dev --port 4101 --hostname 127.0.0.1 \
      > "$LOG_DIR/admin.log" 2>&1 & echo $! > "$LOG_DIR/admin.pid" )
fi
printf 'waiting for QA admin'
for _ in $(seq 1 120); do
  code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4101/login || true)"
  if [[ "$code" == '200' || "$code" == '307' || "$code" == '308' ]]; then
    echo " ok ($code)"
    break
  fi
  printf '.'
  sleep 1
done

# ---------- 7. Playwright (real API, real admin) ----------
cd "$REPO_ROOT/apps/admin-next"
QA_NO_WEB_SERVER=1 \
QA_ADMIN_URL='http://127.0.0.1:4101' \
QA_API_URL='http://127.0.0.1:4102/api' \
  ../../node_modules/.bin/playwright test \
    --config=playwright.qa.config.ts \
    --project=qa-chromium \
    --reporter=list

echo
echo 'Batch 1 QA complete. Reports: qa/reports/batch-1.md, qa/reports/playwright-report/'
echo 'Stop QA processes: bash qa/scripts/run-batch1.sh --stop'
