#!/usr/bin/env python3
"""
运营指标口径核对（reliable-ai-runtime 6.2）
=============================================

本地库只有个位数真实会话，凑不够 20 条人工抽样。
这里用「构造真值」的方式核对口径：写入 20 条带已知标签的合成会话，
再用 ai-quality-report.py 的同一套 SQL 反算，逐条比对。

覆盖的构造类型：
  - 未转人工 + 有 AI 回复  → 独立解决（solved）
  - 已转人工 + 有 AI 回复  → 未解决
  - 已转人工 + 无 AI 回复  → 未解决（含 first_response_at，供 P95）
  - 未转人工 + 无 AI 回复  → 未解决（AI 被问过但没答，不能从分母消失）

输出：逐条 computed vs expected + 四项指标；一致率 <90% 时退出码 1。
会清理上一次同名样本，并在结束时删除本次样本（--keep 可保留）。

用法：
  python3 tools/ops/quality-sample-calibration.py
  python3 tools/ops/quality-sample-calibration.py --keep
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import time

DEFAULT_CONTAINER = "lucky-db"
TITLE = "【口径核对】"


def run_sql(sql: str, container: str) -> list[list[str]]:
    script = 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F "\t" -f -'
    proc = subprocess.run(
        ["docker", "exec", "-i", container, "sh", "-lc", script],
        input=sql,
        text=True,
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0 or "ERROR:" in proc.stderr:
        sys.exit(f"❌ SQL 失败：{proc.stderr.strip()[:500]}")
    return [line.split("\t") for line in proc.stdout.strip().splitlines() if line]


def one(sql: str, container: str) -> str:
    rows = run_sql(sql, container)
    return rows[0][0] if rows and rows[0] else ""


def build_cases() -> list[dict]:
    cases: list[dict] = []
    # 10 条独立解决
    for i in range(1, 11):
        cases.append(
            dict(idx=i, transferred=False, has_ai=True, first_response=False,
                 reason=None, expected=True)
        )
    # 4 条转人工 + AI 回复，其中前 3 条有首响时间（P95 样本）
    for n, i in enumerate(range(11, 15)):
        cases.append(
            dict(idx=i, transferred=True, has_ai=True, first_response=n < 3,
                 reason="explicit_request" if n < 2 else "negative_sentiment",
                 expected=False)
        )
    # 3 条转人工 + 无 AI 回复，其中 2 条有首响时间
    for n, i in enumerate(range(15, 18)):
        cases.append(
            dict(idx=i, transferred=True, has_ai=False, first_response=n < 2,
                 reason="ai_error", expected=False)
        )
    # 3 条未转人工 + 无 AI 回复（AI 没答上来）
    for i in range(18, 21):
        cases.append(
            dict(idx=i, transferred=False, has_ai=False, first_response=False,
                 reason=None, expected=False)
        )
    return cases


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--container", default=DEFAULT_CONTAINER)
    parser.add_argument("--keep", action="store_true", help="保留合成样本")
    args = parser.parse_args()
    c = args.container

    if shutil.which("docker") is None:
        sys.exit("❌ 需要 docker")

    user_id = one(
        'SELECT id FROM users WHERE is_robot = false ORDER BY created_at ASC LIMIT 1;',
        c,
    )
    bot_id = one(
        'SELECT id FROM users WHERE is_robot = true ORDER BY created_at ASC LIMIT 1;',
        c,
    )
    if not user_id or not bot_id:
        sys.exit("❌ 找不到真人用户或 AI 占位账号")

    run_id = f"qcal-{int(time.time())}"
    cases = build_cases()

    # 清理历史样本（先消息后会话，避免外键）
    run_sql(
        f"""
        DELETE FROM "ChatMessage" WHERE "conversationId" IN (
          SELECT id FROM "Conversation" WHERE name LIKE '{TITLE}%'
        );
        DELETE FROM "Conversation" WHERE name LIKE '{TITLE}%';
        """,
        c,
    )

    statements: list[str] = []
    for case in cases:
        conv_id = f"{run_id}-{case['idx']:02d}"
        transferred_at = (
            "now() - interval '10 minutes'" if case["transferred"] else "NULL"
        )
        first_response_at = (
            "now() - interval '10 minutes' + interval '{} seconds'".format(
                10 + case["idx"]
            )
            if case["first_response"]
            else "NULL"
        )
        reason = f"'{case['reason']}'" if case["reason"] else "NULL"
        statements.append(
            f"""
            INSERT INTO "Conversation"
              (id, type, name, thread_id, handler_id, transferred_at,
               first_response_at, transfer_reason, "createdAt", "updatedAt")
            VALUES
              ('{conv_id}', 'SUPPORT', '{TITLE}{case['idx']:02d}', gen_random_uuid()::text,
               NULL, {transferred_at}, {first_response_at}, {reason}, now(), now());
            INSERT INTO "ChatMessage"
              (id, "conversationId", "senderId", type, content, "seqId", role, source, "createdAt")
            VALUES
              ('{run_id}-u-{case['idx']:02d}', '{conv_id}', '{user_id}', 0,
               '用户问题 {case['idx']}', 1, 'user', 'user', now());
            """
        )
        if case["has_ai"]:
            statements.append(
                f"""
                INSERT INTO "ChatMessage"
                  (id, "conversationId", "senderId", type, content, "seqId", role, source, "createdAt")
                VALUES
                  ('{run_id}-a-{case['idx']:02d}', '{conv_id}', '{bot_id}', 0,
                   'AI 回复 {case['idx']}', 2, 'assistant', 'ai', now());
                """
            )

    run_sql("BEGIN;\n" + "\n".join(statements) + "\nCOMMIT;", c)

    # 与 ai-quality-report.py 完全相同的「独立解决」判定
    rows = run_sql(
        f"""
        SELECT c.id,
               (c.transferred_at IS NULL AND EXISTS (
                  SELECT 1 FROM "ChatMessage" m
                  WHERE m."conversationId" = c.id AND m.source = 'ai'
               ))::text
        FROM "Conversation" c
        WHERE c.name LIKE '{TITLE}%'
        ORDER BY c.name;
        """,
        c,
    )
    computed = {row[0]: row[1] == "true" for row in rows}

    print(f"{'会话':<24} {'构造真值':<8} {'报告口径':<8} 一致")
    print("-" * 52)
    agree = 0
    for case in cases:
        cid = f"{run_id}-{case['idx']:02d}"
        got = computed.get(cid)
        same = got is not None and got == case["expected"]
        agree += 1 if same else 0
        print(
            f"{case['idx']:02d} {'solved' if case['expected'] else 'unsolved':<10}"
            f"{'solved' if got else 'unsolved':<10}{'✓' if same else '✗'}"
        )

    total = len(cases)
    rate = agree / total * 100
    print("-" * 52)
    print(f"一致率：{agree}/{total} = {rate:.0f}%（门槛 ≥90%）")

    # 四项指标（限定在合成样本内，口径与报告一致）
    sessions = one(
        f"SELECT count(*) FROM \"Conversation\" WHERE name LIKE '{TITLE}%';", c
    )
    solved_n = one(
        f"""
        SELECT count(*) FROM "Conversation" c
        WHERE c.name LIKE '{TITLE}%'
          AND c.transferred_at IS NULL
          AND EXISTS (SELECT 1 FROM "ChatMessage" m
                      WHERE m."conversationId" = c.id AND m.source = 'ai');
        """,
        c,
    )
    p95 = one(
        f"""
        SELECT COALESCE(percentile_cont(0.95) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (c.first_response_at - c.transferred_at)) * 1000
        )::text, 'NULL')
        FROM "Conversation" c
        WHERE c.name LIKE '{TITLE}%'
          AND c.first_response_at IS NOT NULL
          AND c.transferred_at IS NOT NULL;
        """,
        c,
    )
    reasons = one(
        f"""
        SELECT COALESCE(string_agg(DISTINCT c.transfer_reason, '、'), 'NULL')
        FROM "Conversation" c
        WHERE c.name LIKE '{TITLE}%' AND c.transfer_reason IS NOT NULL;
        """,
        c,
    )
    print(
        f"合成样本：会话 {sessions}，独立解决 {solved_n}，"
        f"首响 P95 {p95} ms，转人工原因 {reasons}"
    )
    print('单会话 token：不可得（ai_usage_daily 无 conversation 维度）')

    if not args.keep:
        run_sql(
            f"""
            DELETE FROM "ChatMessage" WHERE "conversationId" IN (
              SELECT id FROM "Conversation" WHERE name LIKE '{TITLE}%'
            );
            DELETE FROM "Conversation" WHERE name LIKE '{TITLE}%';
            """,
            c,
        )
        print("已清理合成样本")

    return 0 if rate >= 90 else 1


if __name__ == "__main__":
    sys.exit(main())
