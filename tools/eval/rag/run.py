#!/usr/bin/env python3
"""
RAG 检索离线评测（只依赖标准库）

用法：
  tools/eval/rag/run-replay.sh              # 自动签 admin token
  EVAL_TOKEN=xxx python3 tools/eval/rag/run.py
  EVAL_TOKEN=xxx python3 tools/eval/rag/run.py --topk 5 --delay 0.2

指标：Hit@1 / Hit@3 / MRR / p50 / p95，以及按域细分。
报告写到 tools/eval/rag/reports/<timestamp>.json。
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_GOLDEN = SCRIPT_DIR / "golden.jsonl"
REPORT_DIR = SCRIPT_DIR / "reports"
DEFAULT_BASE_URL = "http://localhost/api/v1"
# 全局限流 60 次/分钟；每题 2 次请求，1.1s 间隔可稳定落在限流以下。
DEFAULT_DELAY = 1.1


def load_golden(path: Path) -> list[dict]:
    items: list[dict] = []
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        item = json.loads(line)
        if not item.get("id") or not item.get("query") or not item.get("expectedDocIds"):
            raise SystemExit(f"golden.jsonl line {lineno} is invalid")
        items.append(item)
    return items


def search(base_url: str, token: str, query: str, topk: int, domain: str | None):
    payload = {"query": query, "topK": topk}
    if domain:
        payload["domain"] = domain

    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/admin/rag/documents/search",
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
            with urllib.request.urlopen(request, timeout=60) as response:
                body = json.loads(response.read().decode("utf-8"))
            if body.get("code") != 10000:
                raise RuntimeError(f"API error: {body}")
            return body.get("data") or []
        except urllib.error.HTTPError as error:
            if error.code == 429 and attempt == 0:
                time.sleep(60)
                continue
            raise


def unique_doc_ids(results: list[dict]) -> list[str]:
    seen: set[str] = set()
    doc_ids: list[str] = []
    for result in results:
        doc_id = result.get("docId")
        if doc_id and doc_id not in seen:
            seen.add(doc_id)
            doc_ids.append(doc_id)
    return doc_ids


def first_hit_rank(doc_ids: list[str], expected: list[str]) -> int:
    for index, doc_id in enumerate(doc_ids, 1):
        if doc_id in expected:
            return index
    return 0


def summarize(rows: list[dict], rank_key: str, latency_key: str) -> dict:
    relevant = [row for row in rows if row.get(rank_key) is not None]
    if not relevant:
        return {"n": 0, "hit1": 0.0, "hit3": 0.0, "mrr": 0.0, "p50": 0, "p95": 0}

    ranks = [row[rank_key] for row in relevant]
    n = len(ranks)
    latencies = sorted(row[latency_key] for row in relevant)
    return {
        "n": n,
        "hit1": sum(1 for rank in ranks if rank == 1) / n,
        "hit3": sum(1 for rank in ranks if 1 <= rank <= 3) / n,
        "mrr": sum((1 / rank) if rank > 0 else 0 for rank in ranks) / n,
        "p50": latencies[int(n * 0.5) - 1],
        "p95": latencies[min(n - 1, int(n * 0.95) - 1)],
    }


def pct(value: float) -> str:
    return f"{value * 100:.1f}%"


def main() -> int:
    parser = argparse.ArgumentParser(description="RAG retrieval offline evaluation")
    parser.add_argument("--base-url", default=os.environ.get("EVAL_BASE_URL", DEFAULT_BASE_URL))
    parser.add_argument("--golden", default=str(DEFAULT_GOLDEN))
    parser.add_argument("--topk", type=int, default=5)
    parser.add_argument("--delay", type=float, default=DEFAULT_DELAY)
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    token = os.environ.get("EVAL_TOKEN", "").strip()
    if not token:
        print("❌ 缺少 EVAL_TOKEN。推荐用 tools/eval/rag/run-replay.sh", file=sys.stderr)
        return 2

    items = load_golden(Path(args.golden))
    if args.limit:
        items = items[: args.limit]

    print(f"▶ RAG 回放 {len(items)} 题 → {args.base_url} (topK={args.topk})")
    rows: list[dict] = []

    for index, item in enumerate(items, 1):
        row = {
            "id": item["id"],
            "query": item["query"],
            "domain": item.get("domain"),
            "expectedDocIds": item["expectedDocIds"],
            "retrievedDocIds": [],
            "globalRank": 0,
            "domainRank": None,
            "latencyMs": 0,
            "domainLatencyMs": None,
            "error": None,
        }

        try:
            started = time.perf_counter()
            results = search(args.base_url, token, item["query"], args.topk, None)
            row["latencyMs"] = round((time.perf_counter() - started) * 1000)
            row["retrievedDocIds"] = unique_doc_ids(results)
            row["globalRank"] = first_hit_rank(row["retrievedDocIds"], item["expectedDocIds"])

            if item.get("domain"):
                started = time.perf_counter()
                domain_results = search(
                    args.base_url, token, item["query"], args.topk, item["domain"]
                )
                row["domainLatencyMs"] = round((time.perf_counter() - started) * 1000)
                row["domainRank"] = first_hit_rank(
                    unique_doc_ids(domain_results), item["expectedDocIds"]
                )
        except Exception as error:  # noqa: BLE001 - eval harness should keep going
            row["error"] = str(error)

        rows.append(row)
        mark = "✅" if 1 <= row["globalRank"] <= 3 else "❌"
        print(
            f"  {mark} [{row['id']}] {row['query']} → "
            f"rank={row['globalRank'] or 'miss'} ({row['latencyMs']}ms)"
        )
        if args.delay:
            time.sleep(args.delay)

    global_metrics = summarize(rows, "globalRank", "latencyMs")
    domain_metrics = summarize(rows, "domainRank", "domainLatencyMs")
    per_domain = {}
    for domain in sorted({row["domain"] for row in rows if row.get("domain")}):
        per_domain[domain] = summarize(
            [row for row in rows if row["domain"] == domain], "globalRank", "latencyMs"
        )

    report = {
        "run_at": datetime.now().isoformat(timespec="seconds"),
        "base_url": args.base_url,
        "golden_file": str(args.golden),
        "topk": args.topk,
        "total": len(rows),
        "global": global_metrics,
        "domain_filtered": domain_metrics,
        "per_domain": per_domain,
        "rows": rows,
    }

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report_path = REPORT_DIR / f"{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n── 结果 ──")
    print(
        f"global  Hit@1={pct(global_metrics['hit1'])} "
        f"Hit@3={pct(global_metrics['hit3'])} MRR={global_metrics['mrr']:.3f} "
        f"p50={global_metrics['p50']}ms p95={global_metrics['p95']}ms"
    )
    print(
        f"domain  Hit@1={pct(domain_metrics['hit1'])} "
        f"Hit@3={pct(domain_metrics['hit3'])} MRR={domain_metrics['mrr']:.3f} "
        f"p50={domain_metrics['p50']}ms p95={domain_metrics['p95']}ms "
        f"(n={domain_metrics['n']})"
    )
    for domain, metrics in per_domain.items():
        print(
            f"  {domain:<11} Hit@1={pct(metrics['hit1'])} "
            f"Hit@3={pct(metrics['hit3'])} MRR={metrics['mrr']:.3f}"
        )
    print(f"\nreport: {report_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
