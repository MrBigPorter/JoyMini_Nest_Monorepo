#!/bin/bash
# ============================================
# ECS Fargate 一键停/启控制脚本
# 用法:
#   ./ecs-ctrl.sh stop     ← 睡觉前关掉 Fargate
#   ./ecs-ctrl.sh start    ← 学习前开启 Fargate
#   ./ecs-ctrl.sh status   ← 查看当前状态
#   ./ecs-ctrl.sh restart  ← 重启 Fargate
# ============================================

set -euo pipefail

CLUSTER="tarsier-labs-cluster"
SERVICE="tarsier-labs-service"
REGION="us-east-1"

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; }

check_aws() {
  if ! command -v aws &>/dev/null; then
    error "AWS CLI 未安装，请先安装: https://aws.amazon.com/cli/"
    exit 1
  fi
}

get_status() {
  aws ecs describe-services \
    --cluster "$CLUSTER" \
    --services "$SERVICE" \
    --region "$REGION" \
    --query 'services[0].{status:status,runningCount:runningCount,desiredCount:desiredCount}' \
    --output text
}

get_deployment_info() {
  aws ecs describe-services \
    --cluster "$CLUSTER" \
    --services "$SERVICE" \
    --region "$REGION" \
    --query 'services[0].deployments[0].{status:status,rolloutState:rolloutState}' \
    --output text 2>/dev/null || echo "N/A"
}

cmd_status() {
  echo "=========================================="
  echo "  ECS 服务状态: $CLUSTER / $SERVICE"
  echo "=========================================="

  local status running desired
  read -r status running desired <<< "$(get_status)" 2>/dev/null || true

  if [[ -z "$status" || "$status" == "None" ]]; then
    error "无法获取服务状态，请检查集群/服务名称是否正确"
    echo ""
    echo "可用集群:"
    aws ecs list-clusters --region "$REGION" --query 'clusterArns[]' --output text
    exit 1
  fi

  echo ""
  printf "  服务状态:     %b\n" "$(colorize_status "$status")"
  printf "  运行中实例:   %s\n" "$running"
  printf "  期望实例数:   %s\n" "$desired"
  echo ""

  local deploy_status rollout_state
  read -r deploy_status rollout_state <<< "$(get_deployment_info)" 2>/dev/null || true
  if [[ -n "$deploy_status" && "$deploy_status" != "N/A" ]]; then
    printf "  部署状态:     %b\n" "$(colorize_status "$deploy_status")"
    printf "  滚动状态:     %s\n" "$rollout_state"
  fi

  echo ""
  # 费用估算
  if [[ "$desired" == "1" || "$running" -gt "0" ]]; then
    warn " ⚡ Fargate 当前运行中，日费 ~$0.60-0.80/天"
    warn " ⚡ 如果睡觉不用，建议执行 ./ecs-ctrl.sh stop"
  else
    info " 💤 Fargate 已停止，当前不产生容器费用"
    info " 💡 学习前执行 ./ecs-ctrl.sh start 启动"
  fi
  echo "=========================================="
}

colorize_status() {
  case "$1" in
    ACTIVE|PRIMARY|COMPLETED) echo -e "${GREEN}$1${NC}" ;;
    INACTIVE|DRAINING|FAILED) echo -e "${RED}$1${NC}" ;;
    *) echo -e "${YELLOW}$1${NC}" ;;
  esac
}

cmd_stop() {
  echo ""
  warn "正在停止 Fargate 服务..."
  echo ""

  local current_desired
  current_desired=$(aws ecs describe-services \
    --cluster "$CLUSTER" \
    --services "$SERVICE" \
    --region "$REGION" \
    --query 'services[0].desiredCount' \
    --output text)

  if [[ "$current_desired" == "0" ]]; then
    warn "服务已经处于停止状态，无需操作"
    cmd_status
    return
  fi

  aws ecs update-service \
    --cluster "$CLUSTER" \
    --service "$SERVICE" \
    --region "$REGION" \
    --desired-count 0 \
    --output json > /dev/null

  echo ""
  info " ✅ 停止命令已发送！"
  info "    desiredCount: 1 → 0"
  echo ""
  warn " 等待容器停止中..."
  echo ""

  # 等待服务稳定
  aws ecs wait services-stable \
    --cluster "$CLUSTER" \
    --services "$SERVICE" \
    --region "$REGION" 2>/dev/null || true

  info " ✅ Fargate 已停止，今晚不产生容器费用"
  info "    ★ 明天学习前执行: ./ecs-ctrl.sh start"
  echo ""
}

cmd_start() {
  echo ""
  warn "正在启动 Fargate 服务..."
  echo ""

  local current_desired
  current_desired=$(aws ecs describe-services \
    --cluster "$CLUSTER" \
    --services "$SERVICE" \
    --region "$REGION" \
    --query 'services[0].desiredCount' \
    --output text)

  if [[ "$current_desired" == "1" ]]; then
    warn "服务已经在运行中，无需操作"
    cmd_status
    return
  fi

  aws ecs update-service \
    --cluster "$CLUSTER" \
    --service "$SERVICE" \
    --region "$REGION" \
    --desired-count 1 \
    --output json > /dev/null

  echo ""
  info " ✅ 启动命令已发送！"
  info "    desiredCount: 0 → 1"
  echo ""
  warn " 等待容器启动中（约 1-2 分钟）..."
  echo ""

  # 等待服务稳定
  aws ecs wait services-stable \
    --cluster "$CLUSTER" \
    --services "$SERVICE" \
    --region "$REGION" 2>/dev/null || true

  info " ✅ Fargate 已启动！"
  echo ""
  echo "  ALB 地址: https://tarsier.joyminis.com"
  echo ""
}

cmd_restart() {
  warn "正在重启 Fargate 服务..."
  echo ""

  local current_desired
  current_desired=$(aws ecs describe-services \
    --cluster "$CLUSTER" \
    --services "$SERVICE" \
    --region "$REGION" \
    --query 'services[0].desiredCount' \
    --output text)

  if [[ "$current_desired" == "0" ]]; then
    warn "服务已停止，执行启动而不是重启"
    cmd_start
    return
  fi

  # 强制启动新部署（force new deployment）
  aws ecs update-service \
    --cluster "$CLUSTER" \
    --service "$SERVICE" \
    --region "$REGION" \
    --force-new-deployment \
    --output json > /dev/null

  echo ""
  info " ✅ 重启命令已发送！"
  warn " 等待新版本部署完成..."
  echo ""

  aws ecs wait services-stable \
    --cluster "$CLUSTER" \
    --services "$SERVICE" \
    --region "$REGION" 2>/dev/null || true

  info " ✅ Fargate 重启完成"
  echo ""
}

# ============================================
# Main
# ============================================
check_aws

case "${1:-help}" in
  stop)
    cmd_stop
    ;;
  start)
    cmd_start
    ;;
  restart)
    cmd_restart
    ;;
  status)
    cmd_status
    ;;
  *)
    echo ""
    echo "用法: ./ecs-ctrl.sh {stop|start|restart|status}"
    echo ""
    echo "  stop     ← 睡觉前关掉 Fargate（省容器费）"
    echo "  start    ← 学习前开启 Fargate"
    echo "  restart  ← 强制重新部署（换版本后）"
    echo "  status   ← 查看当前运行状态"
    echo ""
    echo "示例:"
    echo "  ./ecs-ctrl.sh stop      # 关服务器睡觉"
    echo "  ./ecs-ctrl.sh start     # 开服务器学习"
    echo "  ./ecs-ctrl.sh status    # 检查跑没跑"
    echo ""
    ;;
esac
