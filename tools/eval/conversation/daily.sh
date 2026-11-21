#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DATE="${DATE:-$(node -e 'console.log(new Date(Date.now()-86400000).toISOString().slice(0,10))')}"
SOURCES="${DAILY_SOURCES:-real}"
LIMIT="${DAILY_LIMIT:-30}"
SEED="${DAILY_SEED:-42}"
SELECTION="$ROOT/tools/eval/conversation/selection-daily-$DATE.jsonl"
OUT_DIR="$ROOT/tools/eval/conversation/reports/daily-$DATE"

cd "$ROOT/apps/api"
"$ROOT/node_modules/.bin/tsx" --env-file=.env scripts/sample-conversations.ts \
  --date="$DATE" --limit="$LIMIT" --sources="$SOURCES" --seed="$SEED" \
  --out="$SELECTION"

if [[ ! -s "$SELECTION" ]]; then
  echo "[daily] no eligible conversations for $DATE; nothing to evaluate"
  exit 0
fi

cd "$ROOT"
python3 tools/eval/validate.py --selection "$SELECTION"

if [[ "${DAILY_GATE:-0}" == "1" ]]; then
  tools/eval/conversation/run.sh \
    --dataset "$SELECTION" \
    --out-dir "$OUT_DIR" \
    --gate
else
  tools/eval/conversation/run.sh \
    --dataset "$SELECTION" \
    --out-dir "$OUT_DIR"
fi
