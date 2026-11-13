#!/usr/bin/env bash
# PreToolUse 钩子：拦截危险的 Bash 命令。
#
# 输入：stdin 为 JSON，含 tool_input.command
# 命中：把理由写到 stderr，exit 2（harness 拦截并把 stderr 回传给模型）
# 未命中：exit 0 放行

set -uo pipefail

cmd=$(jq -r '.tool_input.command // empty' 2>/dev/null)
[ -z "$cmd" ] && exit 0

deny() {
  printf '⛔ 已拦截：%s\n   %s\n' "$1" "$2" >&2
  exit 2
}

case "$cmd" in
  *"prisma migrate reset"* | *"pr:m:reset"*)
    deny "数据库重置" "这会清空本地库。需要重置请手动执行，并先确认已有备份。"
    ;;
  *"git push --force"* | *"git push -f"*)
    deny "git 强推" "改 main 需先备份，再用 --force-with-lease。"
    ;;
  *"git reset --hard"*)
    deny "git 硬重置" "会丢弃未提交改动。请先 stash 或确认。"
    ;;
esac

# rm -rf 只拦根目录 / 家目录这类灾难目标，不误伤 rm -rf /tmp/build
if printf '%s' "$cmd" |
  grep -qE '(^|[;&|[:space:]])rm[[:space:]]+(-[a-zA-Z]+[[:space:]]+)*(/|~|/\*|\$HOME)([[:space:]]|;|$|[;&|])'; then
  deny "递归删除根/家目录" "拒绝执行。如确需清理请指定具体子目录。"
fi

exit 0
