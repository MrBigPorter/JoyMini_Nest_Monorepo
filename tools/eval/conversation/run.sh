#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT/apps/api"

exec "$ROOT/node_modules/.bin/tsx" --env-file=.env scripts/eval-conversation.ts "$@"
