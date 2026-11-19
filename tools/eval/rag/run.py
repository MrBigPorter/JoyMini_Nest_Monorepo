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
import hashlib
import json
import os
import statistics
import subprocess
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
        source_type = item.get("sourceType", "typical")
        if source_type not in {"typical", "paraphrase", "boundary", "negative"}:
            raise SystemExit(f"golden.jsonl line {lineno}: invalid sourceType")
        if item.get("lang") and item["lang"] not in {"zh", "en", "mixed"}:
            raise SystemExit(f"golden.jsonl line {lineno}: invalid lang")
        if "expectedLayers" in item and not isinstance(item["expectedLayers"], list):
            raise SystemExit(f"golden.jsonl line {lineno}: expectedLayers must be a list")
        # 负样本允许 expectedDocIds 为空；正样本仍必须给出期望文档
        if not item.get("id") or not item.get("query"):
            raise SystemExit(f"golden.jsonl line {lineno} is invalid")
        if source_type != "negative" and not item.get("expectedDocIds"):
            raise SystemExit(f"golden.jsonl line {lineno}: expectedDocIds required")
        items.append(item)
    return items


def search(
    base_url: str,
    token: str,
    query: str,
    topk: int,
    domain: str | None,
    rerank: bool | None = None,
    debug: bool = False,
):
    payload = {"query": query, "topK": topk}
    if domain:
        payload["domain"] = domain
    if rerank is not None:
        payload["rerank"] = rerank
    if debug:
        payload["debug"] = True

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


def split_response(data) -> tuple[list[dict], dict | None]:
    """debug=true 时接口返回 {results, debug}；老服务端仍返回数组。"""
    if isinstance(data, dict):
        return data.get("results") or [], data.get("debug")
    return data or [], None


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


def layer_rank(debug: dict | None, layer: str, expected: list[str]) -> int | None:
    if not debug or not expected:
        return None
    if layer == "keyword":
        merged: list[str] = []
        seen: set[str] = set()
        for name in ("chunk", "doc"):
            for doc_id in debug.get("layers", {}).get(name, {}).get("docIds", []):
                if doc_id not in seen:
                    seen.add(doc_id)
                    merged.append(doc_id)
        return first_hit_rank(merged, expected)
    doc_ids = debug.get("layers", {}).get(layer, {}).get("docIds", [])
    return first_hit_rank(doc_ids, expected)


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


def version_snapshot(golden_path: Path) -> dict:
    """记录可追溯信息；拿不到的字段写 None，不猜。"""
    try:
        git_sha = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
    except Exception:
        git_sha = None

    counts = {"documents": None, "chunks": None}
    try:
        sql = (
            "SELECT (SELECT count(*) FROM knowledge_documents),"
            " (SELECT count(*) FROM document_chunks);"
        )
        proc = subprocess.run(
            [
                "docker",
                "exec",
                "-e",
                f"SQL={sql}",
                "lucky-db",
                "sh",
                "-c",
                'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -F "," -c "$SQL"',
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        docs, chunks = proc.stdout.strip().split(",")
        counts = {"documents": int(docs), "chunks": int(chunks)}
    except Exception:
        pass

    return {
        "git_sha": git_sha,
        "golden_sha256": hashlib.sha256(golden_path.read_bytes()).hexdigest(),
        "knowledge_documents": counts["documents"],
        "document_chunks": counts["chunks"],
        "embedding_model": os.environ.get("EVAL_EMBEDDING_MODEL", "bge-m3"),
        "reranker_model": os.environ.get(
            "EVAL_RERANKER_MODEL", "bge-reranker-v2-m3"
        ),
        "meili_index": "document_chunks",
    }



def main() -> int:
    parser = argparse.ArgumentParser(description="RAG retrieval offline evaluation")
    parser.add_argument("--base-url", default=os.environ.get("EVAL_BASE_URL", DEFAULT_BASE_URL))
    parser.add_argument("--golden", default=str(DEFAULT_GOLDEN))
    parser.add_argument("--topk", type=int, default=5)
    parser.add_argument("--delay", type=float, default=DEFAULT_DELAY)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument(
        "--compare-rerank",
        action="store_true",
        help="同时跑 rerank=false，比较 reranker 的贡献",
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="请求分层召回明细（需要新版后端；默认关闭）",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="只读取并校验题集，不发起请求（不需要 EVAL_TOKEN）",
    )
    args = parser.parse_args()

    items = load_golden(Path(args.golden))
    if args.limit:
        items = items[: args.limit]

    if args.dry_run:
        langs = {}
        types = {}
        for item in items:
            langs[item.get("lang", "unknown")] = langs.get(item.get("lang", "unknown"), 0) + 1
            source = item.get("sourceType", "typical")
            types[source] = types.get(source, 0) + 1
        # 查重：精确重复 + 高相似（≥0.9）；重复会让指标虚高
        from difflib import SequenceMatcher

        norms = [
            "".join(ch.lower() for ch in item["query"] if ch.isalnum())
            for item in items
        ]
        duplicates = []
        for i in range(len(norms)):
            for j in range(i + 1, len(norms)):
                if norms[i] == norms[j] or SequenceMatcher(
                    None, norms[i], norms[j]
                ).ratio() >= 0.9:
                    duplicates.append((items[i]["id"], items[j]["id"]))
        if duplicates:
            print(f"❌ 题集重复：{duplicates[:10]}")
            return 1
        print(
            f"✓ 题集可读：{len(items)} 条 | lang={langs} | sourceType={types}"
        )
        return 0

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
            "lang": item.get("lang", "unknown"),
            "sourceType": item.get("sourceType", "typical"),
            "expectedDocIds": item.get("expectedDocIds") or [],
            "retrievedDocIds": [],
            "retrievedCount": 0,
            "topScore": None,
            "globalRank": 0,
            "noRerankRank": None,
            "domainRank": None,
            "layerRanks": {},
            "latencyMs": 0,
            "noRerankLatencyMs": None,
            "domainLatencyMs": None,
            "error": None,
        }

        try:
            started = time.perf_counter()
            data = search(
                args.base_url, token, item["query"], args.topk, None, debug=args.debug
            )
            results, debug = split_response(data)
            row["latencyMs"] = round((time.perf_counter() - started) * 1000)
            row["retrievedDocIds"] = unique_doc_ids(results)
            row["retrievedCount"] = len(results)
            row["topScore"] = results[0].get("score") if results else None
            if row["sourceType"] != "negative":
                row["globalRank"] = first_hit_rank(
                    row["retrievedDocIds"], row["expectedDocIds"]
                )
            expected = row["expectedDocIds"]
            row["layerRanks"] = {
                layer: layer_rank(debug, layer, expected)
                for layer in ("vector", "meili", "chunk", "doc", "keyword")
            }
            if args.delay:
                time.sleep(args.delay)

            if args.compare_rerank:
                started = time.perf_counter()
                no_rerank_results = search(
                    args.base_url,
                    token,
                    item["query"],
                    args.topk,
                    None,
                    rerank=False,
                )
                row["noRerankLatencyMs"] = round(
                    (time.perf_counter() - started) * 1000
                )
                row["noRerankRank"] = first_hit_rank(
                    unique_doc_ids(no_rerank_results), item["expectedDocIds"]
                )
                if args.delay:
                    time.sleep(args.delay)

            if item.get("domain"):
                started = time.perf_counter()
                domain_results = search(
                    args.base_url, token, item["query"], args.topk, item["domain"]
                )
                row["domainLatencyMs"] = round(
                    (time.perf_counter() - started) * 1000
                )
                row["domainRank"] = first_hit_rank(
                    unique_doc_ids(domain_results), item["expectedDocIds"]
                )
                if args.delay:
                    time.sleep(args.delay)
        except Exception as error:  # noqa: BLE001 - eval harness should keep going
            row["error"] = str(error)

        rows.append(row)
        if row["sourceType"] == "negative":
            mark = "✅" if row["retrievedCount"] == 0 else "❌"
            detail = f"returned={row['retrievedCount']}"
        else:
            mark = "✅" if 1 <= row["globalRank"] <= 3 else "❌"
            detail = f"rank={row['globalRank'] or 'miss'}"
        print(
            f"  {mark} [{row['id']}] {row['query']} → "
            f"{detail} ({row['latencyMs']}ms)"
        )

    positives = [row for row in rows if row["sourceType"] != "negative"]
    negatives = [row for row in rows if row["sourceType"] == "negative"]

    global_metrics = summarize(positives, "globalRank", "latencyMs")
    domain_metrics = summarize(positives, "domainRank", "domainLatencyMs")
    no_rerank_metrics = (
        summarize(positives, "noRerankRank", "noRerankLatencyMs")
        if args.compare_rerank
        else None
    )
    per_domain = {}
    for domain in sorted({row["domain"] for row in positives if row.get("domain")}):
        per_domain[domain] = summarize(
            [row for row in positives if row["domain"] == domain],
            "globalRank",
            "latencyMs",
        )
    per_lang = {}
    for lang in sorted({row["lang"] for row in positives}):
        per_lang[lang] = summarize(
            [row for row in positives if row["lang"] == lang],
            "globalRank",
            "latencyMs",
        )
    layer_metrics = {}
    for layer in ("vector", "meili", "chunk", "doc", "keyword"):
        hit = sum(
            1
            for row in positives
            if (row["layerRanks"].get(layer) or 0) > 0
        )
        layer_metrics[layer] = {
            "n": len(positives),
            "hit": hit,
            "recall": hit / len(positives) if positives else 0.0,
        }
    negative_metrics = {
        "n": len(negatives),
        "falsePositive": sum(1 for row in negatives if row["retrievedCount"] > 0),
        "falsePositiveRate": (
            sum(1 for row in negatives if row["retrievedCount"] > 0) / len(negatives)
            if negatives
            else None
        ),
    }

    report = {
        "run_at": datetime.now().isoformat(timespec="seconds"),
        "base_url": args.base_url,
        "golden_file": str(args.golden),
        "topk": args.topk,
        "total": len(rows),
        "versions": version_snapshot(Path(args.golden)),
        "global": global_metrics,
        "domain_filtered": domain_metrics,
        "no_rerank": no_rerank_metrics,
        "layer_metrics": layer_metrics,
        "negative": negative_metrics,
        "per_domain": per_domain,
        "per_lang": per_lang,
        # compare.py 读取 records[{expect,predicted}]；RAG 报告补这一层
        "records": [
            {
                "id": row["id"],
                "input": row["query"],
                "expect": row["expectedDocIds"][0] if row["expectedDocIds"] else "",
                "predicted": row["retrievedDocIds"][0] if row["retrievedDocIds"] else "",
                "correct": (
                    row["retrievedCount"] == 0
                    if row["sourceType"] == "negative"
                    else row["globalRank"] == 1
                ),
            }
            for row in rows
        ],
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
    if no_rerank_metrics:
        print(
            f"no-rank Hit@1={pct(no_rerank_metrics['hit1'])} "
            f"Hit@3={pct(no_rerank_metrics['hit3'])} "
            f"MRR={no_rerank_metrics['mrr']:.3f} "
            f"p50={no_rerank_metrics['p50']}ms p95={no_rerank_metrics['p95']}ms"
        )
        print(
            f"delta   Hit@1={100 * (global_metrics['hit1'] - no_rerank_metrics['hit1']):+.1f}pp "
            f"Hit@3={100 * (global_metrics['hit3'] - no_rerank_metrics['hit3']):+.1f}pp "
            f"MRR={global_metrics['mrr'] - no_rerank_metrics['mrr']:+.3f}"
        )
    for domain, metrics in per_domain.items():
        print(
            f"  {domain:<11} Hit@1={pct(metrics['hit1'])} "
            f"Hit@3={pct(metrics['hit3'])} MRR={metrics['mrr']:.3f}"
        )
    print(
        "  layers    "
        + " ".join(
            f"{name}={pct(metrics['recall'])}"
            for name, metrics in layer_metrics.items()
        )
    )
    if negatives:
        print(
            f"  negative  n={negative_metrics['n']} "
            f"false-positive={negative_metrics['falsePositive']} "
            f"({pct(negative_metrics['falsePositiveRate'] or 0)})"
        )
    print(f"\nreport: {report_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
