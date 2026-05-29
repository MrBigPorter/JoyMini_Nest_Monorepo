# ============================================
# Makefile — ECS Fargate 一键停/启
# 用法:
#   make         ← 查看帮助
#   make stop    ← 睡觉前关掉 Fargate（省容器费）
#   make start   ← 学习前开启 Fargate
#   make status  ← 查看当前运行状态
#   make restart ← 重新部署
# ============================================

.PHONY: help stop start status restart

help:
	@echo ""
	@echo "📋 ECS Fargate 控制台"
	@echo ""
	@echo "  make stop     ← 睡觉前关掉 Fargate（省容器费）"
	@echo "  make start    ← 学习前开启 Fargate"
	@echo "  make status   ← 查看当前状态"
	@echo "  make restart  ← 强制重新部署"
	@echo ""
	@echo "示例:"
	@echo "  make stop     # 关服务器睡觉 💤"
	@echo "  make start    # 开服务器学习 📚"
	@echo "  make status   # 检查跑没跑 🤔"
	@echo ""

stop:
	@./scripts/ecs-ctrl.sh stop

start:
	@./scripts/ecs-ctrl.sh start

status:
	@./scripts/ecs-ctrl.sh status

restart:
	@./scripts/ecs-ctrl.sh restart
