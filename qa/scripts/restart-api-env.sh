#!/usr/bin/env bash
# Restart the QA API on 4102, optionally overriding env vars.
#
#   bash qa/scripts/restart-api-env.sh                    # normal QA env
#   bash qa/scripts/restart-api-env.sh AI_EVAL_ENABLED=false
#
# Overrides are applied after sourcing qa/.env.qa. Used by eval-queue tests to
# prove (a) queued jobs survive a process restart and (b) the write gate can be
# turned off while cancel keeps working.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

for pid in $(lsof -tiTCP:4102 -sTCP:LISTEN 2>/dev/null || true); do
  kill "$pid" 2>/dev/null || true
done
if [[ -f qa/logs/api.pid ]]; then
  kill "$(cat qa/logs/api.pid)" 2>/dev/null || true
fi
sleep 1

set -a
# shellcheck disable=SC1091
. qa/.env.qa
set +a

for override in "$@"; do
  export "$override"
done

cd apps/api
nohup ../../node_modules/.bin/nest start > ../../qa/logs/api.log 2>&1 &
echo $! > ../../qa/logs/api.pid
cd "$REPO_ROOT"

for _ in $(seq 1 120); do
  if /usr/bin/curl -sf http://127.0.0.1:4102/api/v1/health >/dev/null 2>&1; then
    exit 0
  fi
  sleep 1
done

echo 'QA API restart failed (health check timeout)' >&2
exit 1
