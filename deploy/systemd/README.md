# 每日评测定时任务（systemd）

## 安装

```bash
sudo cp deploy/systemd/joymini-eval.service /etc/systemd/system/
sudo cp deploy/systemd/joymini-eval.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now joymini-eval.timer
```

## 检查

```bash
systemctl list-timers joymini-eval.timer
journalctl -u joymini-eval.service -n 100 --no-pager
```

## 说明

- `WorkingDirectory=/opt/joymini` 需替换为实际部署目录；
- 报告写到 `tools/eval/conversation/reports/`；
- `DAILY_MODE=blocking` 时非零退出码表示确定性门禁失败；
- 脚本默认只抽 `real` 会话，不抽 sim/drill；
- 不向外部服务发送数据，告警由 systemd/journal/上层监控消费。
