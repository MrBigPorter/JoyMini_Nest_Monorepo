#!/usr/bin/env python3
"""
AI 客服运营四指标离线报告（reliable-ai-runtime 6.x）
============================================================

口径（design D5，默认最近 7 天）：

1. 独立解决率 = 未转人工且至少有一条 AI 回复的会话 / 有 AI 参与的会话
2. 首响 P95  = percentile_cont(0.95) over (firstResponseAt - transferredAt)
3. 单会话消耗 = 当前不可得：ai_usage_daily 只有用户+日维度，没有 conversation 维度
4. 转人工原因分布 = 按 transferReason 分组计数

原则：缺数据源就写「不可得」，不用近似值冒充。

用法：
  python3 tools/ops/ai-quality-report.py
  python3 tools/ops/ai-quality-report.py --days 30 --out /tmp/report.md
  DATABASE_URL=postgres://... python3 tools/ops/ai-quality-report.py

默认通过 `docker exec lucky-db psql` 访问本地库；设置 DATABASE_URL 时使用本机 psql。
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone

DEFAULT_CONTAINER = "lucky-db"


def run_sql(sql: str, database_url: str | None, container: str) -> list[list[str]]:
    if database_url:
        if shutil.which("psql") is None:
            sys.exit("❌ DATABASE_URL 已设置，但本机没有 psql")
        cmd = ["psql", database_url, "-At", "-F", "\t", "-f", "-"]
        proc = subprocess.run(
            cmd, input=sql, text=True, capture_output=True, check=False
        )
    else:
        script = 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F "\t" -f -'
        proc = subprocess.run(
            ["docker", "exec", "-i", container, "sh", "-lc", script],
            input=sql,
            text=True,
            capture_output=True,
            check=False,
        )
    if proc.returncode != 0 or "ERROR:" in proc.stderr:
        sys.exit(f"❌ SQL 失败：{proc.stderr.strip()[:300]}")
    return [line.split("\t") for line in proc.stdout.strip().splitlines() if line]


def metric_solved(days: int, dsn: str | None, container: str) -> dict:
    rows = run_sql(
        f"""
        SELECT
          count(*) AS sessions,
          count(*) FILTER (
            WHERE c.transferred_at IS NULL
              AND EXISTS (
                SELECT 1 FROM "ChatMessage" m
                WHERE m."conversationId" = c.id AND m.source = 'ai'
              )
          ) AS solved
        FROM "Conversation" c
        WHERE c.type IN ('SUPPORT','AI')
          AND c."createdAt" >= now() - interval '{days} days';
        """,
        dsn,
        container,
    )
    sessions, solved = (int(rows[0][0]), int(rows[0][1])) if rows else (0, 0)
    if sessions == 0:
        return {"value": None, "unavailable": "窗口内没有 AI 会话"}
    return {
        "value": round(solved / sessions * 100, 1),
        "unit": "%",
        "numerator": solved,
        "denominator": sessions,
    }


def metric_first_response_p95(days: int, dsn: str | None, container: str) -> dict:
    rows = run_sql(
        f"""
        SELECT count(*), percentile_cont(0.95) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (c.first_response_at - c.transferred_at)) * 1000
        )
        FROM "Conversation" c
        WHERE c.first_response_at IS NOT NULL
          AND c.transferred_at IS NOT NULL
          AND c."createdAt" >= now() - interval '{days} days';
        """,
        dsn,
        container,
    )
    count = int(rows[0][0]) if rows else 0
    p95 = rows[0][1] if rows and len(rows[0]) > 1 else None
    if count == 0 or not p95:
        return {"value": None, "unavailable": "窗口内没有「已转人工且已首响」的会话"}
    return {"value": round(float(p95), 0), "unit": "ms", "samples": count}


def metric_tokens_per_conversation() -> dict:
    # ai_usage_daily 只有 userId + date，没有 conversationId
    return {
        "value": None,
        "unavailable": "ai_usage_daily 只按用户+日聚合，没有 conversation 维度",
    }


def metric_transfer_reasons(days: int, dsn: str | None, container: str) -> dict:
    rows = run_sql(
        f"""
        SELECT COALESCE(c.transfer_reason, 'unknown'), count(*)
        FROM "Conversation" c
        WHERE c.transferred_at IS NOT NULL
          AND c.transferred_at >= now() - interval '{days} days'
        GROUP BY 1
        ORDER BY 2 DESC;
        """,
        dsn,
        container,
    )
    distribution = {row[0]: int(row[1]) for row in rows}
    total = sum(distribution.values())
    if total == 0:
        return {"value": None, "unavailable": "窗口内没有转人工会话"}
    return {
        "value": {
            key: {"count": count, "share": round(count / total * 100, 1)}
            for key, count in distribution.items()
        },
        "total": total,
    }


def fmt(value: dict, kind: str) -> str:
    if value.get("value") is None:
        return f"不可得（{value.get('unavailable', '原因未记录')}）"
    if kind == "p95":
        return f"{int(value['value'])} ms（n={value['samples']}）"
    if kind == "solved":
        return (
            f"{value['value']}%（{value['numerator']}/{value['denominator']}）"
        )
    if kind == "reasons":
        return ", ".join(
            f"{k}: {v['count']}（{v['share']}%）"
            for k, v in value["value"].items()
        )
    return str(value["value"])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--out", help="可选：写 markdown 文件")
    parser.add_argument("--container", default=DEFAULT_CONTAINER)
    args = parser.parse_args()

    dsn = os.environ.get("DATABASE_URL")
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    solved = metric_solved(args.days, dsn, args.container)
    p95 = metric_first_response_p95(args.days, dsn, args.container)
    tokens = metric_tokens_per_conversation()
    reasons = metric_transfer_reasons(args.days, dsn, args.container)

    report = {
        "generatedAt": now,
        "windowDays": args.days,
        "source": "postgres",
        "metrics": {
            "independentResolutionRate": solved,
            "firstResponseP95": p95,
            "tokensPerConversation": tokens,
            "transferReasonDistribution": reasons,
        },
    }

    md = [
        f"# AI 客服运营指标（最近 {args.days} 天）",
        "",
        f"- 生成时间：{now}",
        f"- 数据源：PostgreSQL",
        "",
        "| 指标 | 结果 |",
        "|---|---|",
        f"| 独立解决率 | {fmt(solved, 'solved')} |",
        f"| 首响 P95 | {fmt(p95, 'p95')} |",
        f"| 单会话 token 消耗 | {fmt(tokens, 'tokens')} |",
        f"| 转人工原因分布 | {fmt(reasons, 'reasons')} |",
        "",
        "说明：缺数据源的指标标记为「不可得」，不使用近似值。",
    ]
    text = "\n".join(md)
    print(text)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(text + "\n")
        print(f"\nwritten: {args.out}")
    print("\n" + json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
