#!/usr/bin/env python3
"""
RAG faithfulness proxy 评测（只依赖标准库）

通过真实 test-chat 图路径拿「answer + sources」，然后计算：
  - with_sources_rate   ：回答是否带引用
  - citation_rate       ：回答正文是否引用了来源标题/docId
  - numeric_support_rate：回答里的数字是否都能在 sources 中找到
  - expected_source_hit ：期望文档是否出现在 sources（图内检索命中）
  - p50/p95 延迟

注意：这是 proxy，不是 LLM-as-Judge；数字支持率只能抓「编造数字」，
抓不到「语义歪曲」。报告里必须标注。
"""

from __future__ import annotations

import argparse
import json
import os
import re
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

NUMBER_RE = re.compile(r"\d+(?:[.,]\d+)?")


def load_golden(path: Path) -> list[dict]:
    items = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            items.append(json.loads(line))
    return items


def ask(base_url: str, token: str, query: str, timeout: int = 60) -> dict:
    payload = {
        "message": query,
        "sessionId": str(uuid.uuid4()),
        "debug": False,
    }
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/ai/customer/test-chat",
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


def source_text(sources: list[dict]) -> str:
    parts = []
    for source in sources:
        parts.append(str(source.get("title") or ""))
        parts.append(str(source.get("docId") or ""))
        parts.append(str(source.get("content") or ""))
    return "\n".join(parts)


def normalized_number(value: str) -> str:
    return value.replace(",", "")


def has_citation(answer: str, sources: list[dict]) -> bool:
    lowered = answer.lower()
    for source in sources:
        title = str(source.get("title") or "").lower()
        doc_id = str(source.get("docId") or "").lower()
        if (title and title in lowered) or (doc_id and doc_id in lowered):
            return True
    return False


def numeric_check(answer: str, sources: list[dict]) -> tuple[int, list[str]]:
    numbers = NUMBER_RE.findall(answer)
    if not numbers:
        return 0, []
    text = normalized_number(source_text(sources))
    unsupported = [
        number
        for number in numbers
        if normalized_number(number) not in text
    ]
    return len(numbers), unsupported


def percentile(values: list[int], p: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, int(len(ordered) * p) - 1))
    return ordered[index]


def pct(value: float) -> str:
    return f"{value * 100:.1f}%"


def main() -> int:
    parser = argparse.ArgumentParser(description="RAG faithfulness proxy eval")
    parser.add_argument("--base-url", default=os.environ.get("EVAL_BASE_URL", DEFAULT_BASE_URL))
    parser.add_argument("--golden", default=str(DEFAULT_GOLDEN))
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--delay", type=float, default=0.5)
    args = parser.parse_args()

    token = os.environ.get("EVAL_TOKEN", "").strip()
    if not token:
        print("❌ 缺少 EVAL_TOKEN。推荐用 tools/eval/rag/faithfulness.sh", file=sys.stderr)
        return 2

    items = load_golden(Path(args.golden))[: args.limit]
    print(f"▶ faithfulness proxy: {len(items)} 题 → {args.base_url}")
    rows: list[dict] = []

    for item in items:
        row = {
            "id": item["id"],
            "query": item["query"],
            "expectedDocIds": item["expectedDocIds"],
            "intent": "",
            "answer": "",
            "sources": [],
            "hasSources": False,
            "cited": False,
            "numericTotal": 0,
            "numericUnsupported": [],
            "expectedHit": False,
            "latencyMs": 0,
            "error": None,
        }
        try:
            started = time.perf_counter()
            data = ask(args.base_url, token, item["query"])
            row["latencyMs"] = round((time.perf_counter() - started) * 1000)
            row["intent"] = data.get("intent") or ""
            row["answer"] = data.get("agentOutput") or ""
            row["sources"] = data.get("sources") or []
            row["hasSources"] = len(row["sources"]) > 0
            if row["hasSources"]:
                row["cited"] = has_citation(row["answer"], row["sources"])
                row["numericTotal"], row["numericUnsupported"] = numeric_check(
                    row["answer"], row["sources"]
                )
                retrieved = {s.get("docId") for s in row["sources"] if s.get("docId")}
                row["expectedHit"] = any(
                    doc_id in retrieved for doc_id in item["expectedDocIds"]
                )
        except Exception as error:  # noqa: BLE001
            row["error"] = str(error)

        rows.append(row)
        mark = "✅" if row["hasSources"] else "—"
        print(
            f"  {mark} [{row['id']}] intent={row['intent'] or '?':<10} "
            f"sources={len(row['sources'])} cited={row['cited']} "
            f"nums={row['numericTotal']} ({row['latencyMs']}ms)"
        )
        if args.delay:
            time.sleep(args.delay)

    with_sources = [row for row in rows if row["hasSources"]]
    cited = [row for row in with_sources if row["cited"]]
    numeric_rows = [row for row in with_sources if row["numericTotal"] > 0]
    numeric_ok = [row for row in numeric_rows if not row["numericUnsupported"]]
    expected_rows = [row for row in with_sources if row["expectedHit"]]
    latencies = [row["latencyMs"] for row in rows]

    summary = {
        "total": len(rows),
        "rag_answers": len(with_sources),
        "with_sources_rate": len(with_sources) / len(rows) if rows else 0,
        "citation_rate": len(cited) / len(with_sources) if with_sources else 0,
        "numeric_rows": len(numeric_rows),
        "numeric_support_rate": len(numeric_ok) / len(numeric_rows) if numeric_rows else 0,
        "expected_source_hit_rate": len(expected_rows) / len(with_sources) if with_sources else 0,
        "avg_sources": (
            sum(len(row["sources"]) for row in with_sources) / len(with_sources)
            if with_sources
            else 0
        ),
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
    report_path = REPORT_DIR / f"faithfulness-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n── 结果（proxy）──")
    print(
        f"RAG answers: {summary['rag_answers']}/{summary['total']} "
        f"({pct(summary['with_sources_rate'])}) | citation={pct(summary['citation_rate'])} | "
        f"numeric support={pct(summary['numeric_support_rate'])} "
        f"(n={summary['numeric_rows']}) | expected source={pct(summary['expected_source_hit_rate'])}"
    )
    print(f"p50={summary['p50']}ms p95={summary['p95']}ms")
    unsupported = [
        (row["id"], row["numericUnsupported"])
        for row in numeric_rows
        if row["numericUnsupported"]
    ][:5]
    if unsupported:
        print(f"unsupported numbers (first 5): {unsupported}")
    print(f"\nreport: {report_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
