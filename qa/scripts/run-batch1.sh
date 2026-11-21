#!/usr/bin/env bash
# QA runner — isolated Postgres/Redis, real API, real admin, no mocks.
#
#   bash qa/scripts/run-batch1.sh            # start env + Batch 1 regression + Batch 2
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
PLAYWRIGHT="$REPO_ROOT/node_modules/.bin/playwright"
mkdir -p "$LOG_DIR"

kill_port() {
  local port="$1"
  for pid in $(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true); do
    kill "$pid" 2>/dev/null || true
  done
}

stop_all() {
  kill_port 4101
  kill_port 4102
  kill_port 4199
  rm -f "$LOG_DIR"/admin.pid "$LOG_DIR"/api.pid "$LOG_DIR"/judge-stub.pid
}

if [[ "${1:-}" == "--stop" ]]; then
  stop_all
  if colima status >/dev/null 2>&1; then
    docker compose -f qa/compose.qa.yml down
  fi
  exit 0
fi

# ---------- 0. colima ----------
if ! colima status >/dev/null 2>&1; then
  echo 'starting colima (4 CPU / 4 GiB)…'
  colima start
fi
docker info >/dev/null

# ---------- 1. data services ----------
if docker inspect lucky-db-qa >/dev/null 2>&1; then
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

# ---------- 2. migrations + baseline seed (frozen commit only) ----------
set -a
# shellcheck disable=SC1090
. "$QA_ENV"
set +a
cd "$REPO_ROOT/apps/api"
npx prisma migrate deploy --schema prisma/schema.prisma
cd "$REPO_ROOT"
npx tsx qa/seed/batch1.ts
npx tsx qa/seed/batch2.ts --clean

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

# ---------- 5. admin dev server ----------
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

# ---------- 6. Batch 1 regression on baseline ----------
echo '=== Batch 1 API e2e (baseline) ==='
( cd "$REPO_ROOT/apps/api" && npx jest --config test/jest-e2e.json --runInBand --forceExit \
    test/ai-ops/batch1-permissions.e2e-spec.ts ) 2>&1 | tee "$LOG_DIR/run-batch1-api.log"

echo '=== Batch 1 Playwright (baseline) ==='
( cd "$REPO_ROOT/apps/admin-next" && \
  QA_NO_WEB_SERVER=1 QA_ADMIN_URL='http://127.0.0.1:4101' QA_API_URL='http://127.0.0.1:4102/api' \
  "$PLAYWRIGHT" test --config=playwright.qa.config.ts --project=qa-chromium --reporter=list \
    e2e-qa/navigation.spec.ts e2e-qa/drilldown.spec.ts e2e-qa/insights.spec.ts e2e-qa/redaction.spec.ts \
) 2>&1 | tee "$LOG_DIR/run-batch1-playwright.log"

# ---------- 7. Batch 2 on batch2 seed ----------
npx tsx qa/seed/batch2.ts

echo '=== Batch 2 API e2e ==='
( cd "$REPO_ROOT/apps/api" && npx jest --config test/jest-e2e.json --runInBand --forceExit \
    test/ai-ops/batch2-triage.e2e-spec.ts ) 2>&1 | tee "$LOG_DIR/run-batch2-api.log"

echo '=== Batch 2 Playwright ==='
( cd "$REPO_ROOT/apps/admin-next" && \
  QA_NO_WEB_SERVER=1 QA_ADMIN_URL='http://127.0.0.1:4101' QA_API_URL='http://127.0.0.1:4102/api' \
  "$PLAYWRIGHT" test --config=playwright.qa.config.ts --project=qa-chromium --reporter=list \
    e2e-qa/batch2-triage.spec.ts e2e-qa/insights.spec.ts \
) 2>&1 | tee "$LOG_DIR/run-batch2-playwright.log"

# Leave a deterministic dataset for inspection.
npx tsx qa/seed/batch2.ts

echo
echo 'QA complete. Reports: qa/reports/batch-1.md, qa/reports/batch-2.md'
echo 'Stop QA processes: bash qa/scripts/run-batch1.sh --stop'
