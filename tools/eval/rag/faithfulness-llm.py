#!/usr/bin/env python3
"""
RAG faithfulness —— LLM-as-Judge 评测

流程：
  1. 用 client token 调真实 test-chat，拿 answer + sources
  2. 用 admin token 调 /admin/rag/documents/judge，判断回答是否被 sources 支持
  3. 汇总 faithful rate / avg score / 错误

与 faithfulness.py 的 proxy 不同，这里让 LLM 做语义判断；
仍需人工抽检，LLM judge 本身也会有偏差。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from collections import Counter
from datetime import datetime
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_GOLDEN = SCRIPT_DIR / "golden.jsonl"
REPORT_DIR = SCRIPT_DIR / "reports"
DEFAULT_BASE_URL = "http://localhost/api/v1"


def load_golden(path: Path) -> list[dict]:
    items = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            items.append(json.loads(line))
    return items


def post_json(
    base_url: str,
    token: str,
    path: str,
    payload: dict,
    timeout: int = 120,
) -> dict:
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    for attempt in range(2):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = json.loads(response.read().decode("utf-8"))
            if body.get("code") != 10000:
                raise RuntimeError(f"API error: {body}")
            return body.get("data") or {}
        except urllib.error.HTTPError as error:
            if error.code == 429 and attempt == 0:
                time.sleep(60)
                continue
            raise


def ask_chat(base_url: str, token: str, query: str) -> dict:
    return post_json(
        base_url,
        token,
        "/ai/customer/test-chat",
        {
            "message": query,
            "sessionId": str(uuid.uuid4()),
            "debug": False,
        },
    )


def judge(
    base_url: str,
    token: str,
    question: str,
    answer: str,
    sources: list[dict],
) -> dict:
    judge_sources = [
        {
            "title": source.get("title"),
            "docId": source.get("docId"),
            "content": source.get("content") or "",
        }
        for source in sources
    ]
    return post_json(
        base_url,
        token,
        "/admin/rag/documents/judge",
        {
            "question": question,
            "answer": answer,
            "sources": judge_sources,
        },
    )


def percentile(values: list[int], p: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, int(len(ordered) * p) - 1))
    return ordered[index]


def pct(value: float) -> str:
    return f"{value * 100:.1f}%"


def main() -> int:
    parser = argparse.ArgumentParser(description="RAG faithfulness LLM-as-Judge")
    parser.add_argument("--base-url", default=os.environ.get("EVAL_BASE_URL", DEFAULT_BASE_URL))
    parser.add_argument("--golden", default=str(DEFAULT_GOLDEN))
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--delay", type=float, default=0.3)
    args = parser.parse_args()

    token = os.environ.get("EVAL_TOKEN", "").strip()
    judge_token = os.environ.get("JUDGE_TOKEN", "").strip()
    if not token or not judge_token:
        print(
            "❌ 缺少 EVAL_TOKEN / JUDGE_TOKEN。推荐用 "
            "tools/eval/rag/faithfulness-llm.sh",
            file=sys.stderr,
        )
        return 2

    items = load_golden(Path(args.golden))[: args.limit]
    print(f"▶ LLM-as-Judge faithfulness: {len(items)} 题 → {args.base_url}")
    rows: list[dict] = []

    for item in items:
        row = {
            "id": item["id"],
            "query": item["query"],
            "intent": "",
            "sources": 0,
            "ragAnswer": False,
            "faithful": None,
            "score": None,
            "unsupportedClaims": [],
            "reason": "",
            "error": None,
            "latencyMs": 0,
        }
        try:
            started = time.perf_counter()
            chat = ask_chat(args.base_url, token, item["query"])
            answer = chat.get("agentOutput") or ""
            sources = chat.get("sources") or []
            row["intent"] = chat.get("intent") or ""
            row["sources"] = len(sources)
            row["ragAnswer"] = len(sources) > 0

            if row["ragAnswer"]:
                judged = judge(
                    args.base_url,
                    judge_token,
                    item["query"],
                    answer,
                    sources,
                )
                row["faithful"] = judged.get("faithful")
                row["score"] = judged.get("score")
                row["unsupportedClaims"] = judged.get("unsupportedClaims") or []
                row["reason"] = judged.get("reason") or ""
                if judged.get("error"):
                    row["error"] = judged.get("error")
            row["latencyMs"] = round((time.perf_counter() - started) * 1000)
        except Exception as error:  # noqa: BLE001
            row["error"] = str(error)

        rows.append(row)
        status = (
            "✅"
            if row["faithful"] is True
            else "❌"
            if row["faithful"] is False
            else "—"
        )
        print(
            f"  {status} [{row['id']}] intent={row['intent'] or '?':<10} "
            f"sources={row['sources']} score={row['score']} "
            f"({row['latencyMs']}ms)"
        )
        if args.delay:
            time.sleep(args.delay)

    judged_rows = [row for row in rows if row["faithful"] is not None]
    faithful_rows = [row for row in judged_rows if row["faithful"] is True]
    error_rows = [row for row in judged_rows if row["error"]]
    scores = [row["score"] for row in judged_rows if isinstance(row["score"], (int, float))]
    latencies = [row["latencyMs"] for row in rows]

    summary = {
        "total": len(rows),
        "rag_answers": sum(1 for row in rows if row["ragAnswer"]),
        "judged": len(judged_rows),
        "faithful": len(faithful_rows),
        "faithful_rate": len(faithful_rows) / len(judged_rows) if judged_rows else 0,
        "avg_score": sum(scores) / len(scores) if scores else 0,
        "judge_errors": len(error_rows),
        "p50": percentile(latencies, 0.5),
        "p95": percentile(latencies, 0.95),
        "intents": dict(Counter(row["intent"] for row in rows)),
    }

    report = {
        "run_at": datetime.now().isoformat(timespec="seconds"),
        "base_url": args.base_url,
        "golden_file": str(args.golden),
        "limit": args.limit,
        "summary": summary,
        "rows": rows,
    }
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report_path = REPORT_DIR / f"faithfulness-llm-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n── 结果（LLM-as-Judge）──")
    print(
        f"RAG answers: {summary['rag_answers']}/{summary['total']} | "
        f"judged: {summary['judged']} | faithful: "
        f"{summary['faithful']}/{summary['judged']} "
        f"({pct(summary['faithful_rate'])}) | avg score: "
        f"{summary['avg_score']:.2f} | judge errors: {summary['judge_errors']}"
    )
    print(f"p50={summary['p50']}ms p95={summary['p95']}ms")

    unfaithful = [
        (row["id"], row["unsupportedClaims"])
        for row in judged_rows
        if row["faithful"] is False
    ][:5]
    if unfaithful:
        print(f"unfaithful examples (first 5): {unfaithful}")
    print(f"\nreport: {report_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
