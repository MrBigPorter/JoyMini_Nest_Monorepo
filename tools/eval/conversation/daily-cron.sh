#!/usr/bin/env bash
# 每日定时入口。建议 crontab：
#   10 1 * * * /path/to/repo/tools/eval/conversation/daily-cron.sh
# 退出码非 0 时由 cron 邮件/上层监控告警；脚本本身不向外部服务发送数据。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DATE="${DATE:-$(node -e 'console.log(new Date(Date.now()-86400000).toISOString().slice(0,10))')}"
LOG_DIR="$ROOT/tools/eval/conversation/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/daily-$DATE.log"

STATUS=0
DATE="$DATE" "$ROOT/tools/eval/conversation/daily.sh" >>"$LOG" 2>&1 || STATUS=$?

REPORT_DIR="$ROOT/tools/eval/conversation/reports/daily-$DATE"
LATEST_REPORT="$(ls -t "$REPORT_DIR"/*.md 2>/dev/null | head -1 || true)"

echo "[daily-cron] date=$DATE status=$STATUS report=${LATEST_REPORT:-none}" | tee -a "$LOG"
exit "$STATUS"
