#!/usr/bin/env python3
"""
意图准确率回放（T0-3 / #94）
============================================================

它回答一个问题：**在人工标好的题上，系统现在能答对多少？**

为什么要这个东西
------------------------------------------------------------
"准确率 80%" 这句话，没有题集就没有意义。
有了题集 + 回放，每次改代码才能说：
  「这次改动把 order 域的召回从 71% 提到 86%」
而不是「我觉得变好了」。

它打在哪条生产路径上
------------------------------------------------------------
调用 `POST /admin/intent-examples/test`。这个接口内部构造的
`IntentClassifier` 与生产 `intent-router.node.ts` 是同一个类、
同一份参数 —— 所以测的是生产代码，不是副本。

注意：它只测「意图分类」这一步。回答质量、转人工判定不在范围内
（转人工由 scripts/ai-e2e-smoke.sh 覆盖）。

用法
------------------------------------------------------------
  tools/eval/run-replay.sh                 # 推荐：自动签 token 再调用本脚本
  EVAL_TOKEN=xxx python3 replay.py         # 手动传 token
  python3 replay.py --tag trap             # 只跑陷阱题
  python3 replay.py --limit 10 --verbose   # 调试前 10 条

只用标准库，不需要 pip install。
"""

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

EVAL_DIR = Path(__file__).resolve().parent
GOLDEN = EVAL_DIR / "golden" / "intent.jsonl"
BASELINE = EVAL_DIR / "baseline.json"
REPORT_DIR = EVAL_DIR / "reports"

DEFAULT_BASE_URL = "http://localhost/api/v1"
# 分类本身应该是毫秒级；超过这个时间多半是 embedding 服务在排队
REQUEST_TIMEOUT_SEC = 30
# 全局限流是 60 次 / 60 秒（app.module.ts:149）。撞上就退避重试，
# 否则题目会被记成"答错"——那是harness的问题，不是系统的问题。
MAX_429_RETRIES = 6
DEFAULT_DELAY_SEC = 0.5


# ── 1. 读题集 ────────────────────────────────────────────────
def load_cases(path: Path) -> list[dict]:
    """一行一个 JSON。空行和 # 开头的行跳过，方便手工维护。"""
    cases = []
    with path.open(encoding="utf-8") as f:
        for lineno, raw in enumerate(f, 1):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            try:
                case = json.loads(line)
            except json.JSONDecodeError as e:
                sys.exit(f"❌ {path}:{lineno} 不是合法 JSON：{e}")
            # 缺字段直接报错，不要静默跳过 —— 静默跳过会让分母变小、分数虚高
            for key in ("id", "input", "expect"):
                if key not in case:
                    sys.exit(f"❌ {path}:{lineno} 缺少字段 {key}")
            cases.append(case)
    return cases


# ── 2. 调一次分类接口 ────────────────────────────────────────
def classify(base_url: str, token: str, text: str) -> dict:
    """
    返回 {predicted, top_score, method, latency_ms, error}

    为什么延迟在这里测：服务端的 latencyMs 只覆盖分类内部，
    客户端测的是用户真正感知的时间（含网络、网关、鉴权）。
    """
    url = f"{base_url.rstrip('/')}/admin/intent-examples/test"
    body = json.dumps({"input": text}).encode("utf-8")

    for attempt in range(MAX_429_RETRIES + 1):
        req = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {token}",
            },
        )

        started = time.perf_counter()
        try:
            with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SEC) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:200]
            # 429 是"被门卫拦下"，不是"答错"。退避后重试，不污染分数。
            if e.code == 429 and attempt < MAX_429_RETRIES:
                wait = _retry_after_seconds(e.headers.get("Retry-After"))
                print(f"    ⏳ 429 限流，等待 {wait}s 后重试（第 {attempt + 1} 次）")
                time.sleep(wait)
                continue
            return {
                "predicted": None,
                "top_score": None,
                "method": None,
                "latency_ms": int((time.perf_counter() - started) * 1000),
                "error": f"HTTP {e.code}: {detail}",
            }
        except Exception as e:  # 网络、超时、JSON 解析
            return {
                "predicted": None,
                "top_score": None,
                "method": None,
                "latency_ms": int((time.perf_counter() - started) * 1000),
                "error": str(e),
            }

        latency_ms = int((time.perf_counter() - started) * 1000)
        # 后端返回 {code, message, data:{intent, labels, method, rawTop5}}
        data = payload.get("data", payload) if isinstance(payload, dict) else {}
        labels = data.get("labels") or []
        top_score = labels[0].get("score") if labels else None
        return {
            "predicted": data.get("intent"),
            "top_score": top_score,
            "method": data.get("method"),
            "latency_ms": latency_ms,
            "error": None,
        }

    # 理论上到不了：循环最后一次失败会在上面直接 return
    return {
        "predicted": None,
        "top_score": None,
        "method": None,
        "latency_ms": 0,
        "error": "429 retries exhausted",
    }


def _retry_after_seconds(header_value: str | None) -> int:
    """优先听服务端的 Retry-After；没给就等一个窗口（10s）。"""
    try:
        return max(1, min(60, int(header_value)))
    except (TypeError, ValueError):
        return 10


# ── 3. 汇总指标 ──────────────────────────────────────────────
def percentile(values: list[float], p: float) -> float | None:
    """最近秩法求分位，样本太少时直接返回最大值。"""
    if not values:
        return None
    ordered = sorted(values)
    idx = min(len(ordered) - 1, int(round((p / 100) * (len(ordered) - 1))))
    return ordered[idx]


def compute_metrics(records: list[dict]) -> dict:
    """
    混淆矩阵为主，其余指标从矩阵推导。
    矩阵行 = 期望域，列 = 预测域；对角线就是答对的。
    """
    domains = sorted({r["expect"] for r in records} | {
        r["predicted"] for r in records if r["predicted"]
    })
    matrix = {exp: {pred: 0 for pred in domains} for exp in domains}
    for r in records:
        if r["predicted"]:
            matrix[r["expect"]][r["predicted"]] += 1

    total = len(records)
    correct = sum(1 for r in records if r["predicted"] == r["expect"])

    per_domain = {}
    for d in domains:
        tp = matrix[d].get(d, 0)
        expected_n = sum(matrix[d].values())
        predicted_n = sum(matrix[e].get(d, 0) for e in domains)
        precision = tp / predicted_n if predicted_n else 0.0
        recall = tp / expected_n if expected_n else 0.0
        f1 = (
            2 * precision * recall / (precision + recall)
            if (precision + recall) > 0
            else 0.0
        )
        per_domain[d] = {
            "expected": expected_n,
            "predicted": predicted_n,
            "tp": tp,
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(f1, 4),
        }

    latencies = [r["latency_ms"] for r in records if not r["error"]]
    methods = {}
    for r in records:
        key = r["method"] or "error"
        methods[key] = methods.get(key, 0) + 1

    macro_f1 = (
        sum(v["f1"] for v in per_domain.values()) / len(per_domain)
        if per_domain
        else 0.0
    )

    return {
        "total": total,
        "correct": correct,
        "errors": sum(1 for r in records if r["error"]),
        "accuracy": round(correct / total, 4) if total else 0.0,
        "macro_f1": round(macro_f1, 4),
        "method_distribution": methods,
        "latency_ms": {
            "p50": percentile(latencies, 50),
            "p95": percentile(latencies, 95),
            "max": max(latencies) if latencies else None,
        },
        "per_domain": per_domain,
        "confusion": matrix,
    }


# ── 4. 与基线比较 ────────────────────────────────────────────
def compare_with_baseline(metrics: dict, baseline: dict | None) -> dict:
    if not baseline:
        return {"has_baseline": False, "delta_accuracy": None, "delta_macro_f1": None}
    return {
        "has_baseline": True,
        "baseline_accuracy": baseline.get("accuracy"),
        "baseline_macro_f1": baseline.get("macro_f1"),
        "delta_accuracy": round(
            metrics["accuracy"] - (baseline.get("accuracy") or 0), 4
        ),
        "delta_macro_f1": round(
            metrics["macro_f1"] - (baseline.get("macro_f1") or 0), 4
        ),
    }


# ── 5. 落盘 ──────────────────────────────────────────────────
def pct(v) -> str:
    return "-" if v is None else f"{v * 100:.1f}%"


def write_report(result: dict, out_dir: Path) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    json_path = out_dir / f"{stamp}.json"
    md_path = out_dir / f"{stamp}.md"

    json_path.write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    m = result["metrics"]
    cmp = result["comparison"]
    # 先算好变化文案：避免在 f-string 里再嵌套 f-string（Python < 3.12 不支持同引号嵌套）
    acc_delta = "-" if cmp["delta_accuracy"] is None else f"{cmp['delta_accuracy'] * 100:+.1f}pp"
    f1_delta = "-" if cmp["delta_macro_f1"] is None else f"{cmp['delta_macro_f1'] * 100:+.1f}pp"
    rows = sorted(
        m["per_domain"].items(), key=lambda kv: kv[1]["recall"]
    )  # 最差的排前面，先看该改哪个域

    lines = [
        f"# 意图准确率报告 · {result['run_at']}",
        "",
        f"- 题集：`{result['golden_file']}`（{m['total']} 题）",
        f"- 接口：`{result['base_url']}`",
        "",
        "## 总览",
        "",
        "| 指标 | 本次 | 基线 | 变化 |",
        "|---|---|---|---|",
        f"| Top-1 准确率 | **{pct(m['accuracy'])}** | {pct(cmp.get('baseline_accuracy'))} "
        f"| {acc_delta} |",
        f"| macro-F1 | {pct(m['macro_f1'])} | {pct(cmp.get('baseline_macro_f1'))} "
        f"| {f1_delta} |",
        f"| 答对 / 总数 | {m['correct']} / {m['total']} | - | - |",
        f"| 请求失败 | {m['errors']} | - | - |",
        f"| 分类方式 | {m['method_distribution']} | - | - |",
        f"| 延迟 p50 / p95 | {m['latency_ms']['p50']} / {m['latency_ms']['p95']} ms | - | - |",
        "",
        "## 每个域（按召回从低到高，先看最弱的）",
        "",
        "| 域 | 题数 | 精确率 | 召回率 | F1 |",
        "|---|---|---|---|---|",
    ]
    for domain, s in rows:
        lines.append(
            f"| {domain} | {s['expected']} | {pct(s['precision'])} | "
            f"{pct(s['recall'])} | {pct(s['f1'])} |"
        )

    matrix = m["confusion"]
    domains = list(matrix.keys())
    lines += [
        "",
        "## 混淆矩阵（行=期望，列=预测）",
        "",
        "| 期望 \\ 预测 | " + " | ".join(domains) + " |",
        "|---" * (len(domains) + 1) + "|",
    ]
    for exp in domains:
        cells = []
        for pred in domains:
            n = matrix[exp].get(pred, 0)
            cells.append(f"**{n}**" if exp == pred else (str(n) if n else ""))
        lines.append(f"| {exp} | " + " | ".join(cells) + " |")

    mismatches = [r for r in result["records"] if r["predicted"] != r["expect"]]
    lines += ["", "## 答错的题", ""]
    if not mismatches:
        lines.append("（无）")
    else:
        lines += ["| ID | 输入 | 期望 | 预测 | 分数 | 标注说明 |", "|---|---|---|---|---|---|"]
        for r in mismatches:
            score = "-" if r["top_score"] is None else f"{r['top_score']:.3f}"
            lines.append(
                f"| {r['id']} | {r['input']} | {r['expect']} | "
                f"{r['predicted'] or 'ERROR'} | {score} | {r.get('note', '')} |"
            )

    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return json_path, md_path


# ── 6. 主流程 ────────────────────────────────────────────────
def main() -> int:
    parser = argparse.ArgumentParser(description="意图准确率回放（T0-3）")
    parser.add_argument("--base-url", default=os.environ.get("EVAL_BASE_URL", DEFAULT_BASE_URL))
    parser.add_argument("--golden", default=str(GOLDEN))
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--tag", default=None, help="只跑带该 tag 的题，如 trap")
    parser.add_argument("--fail-under", type=float, default=None,
                        help="准确率低于此值（0~1）退出码 1；默认取基线的 2pp 下浮")
    parser.add_argument("--update-baseline", action="store_true",
                        help="把本次结果写回 baseline.json（需人工确认）")
    parser.add_argument("--verbose", action="store_true", help="逐条打印")
    parser.add_argument("--delay", type=float, default=DEFAULT_DELAY_SEC,
                        help="每条之间的间隔秒数，避免撞全局限流")
    parser.add_argument("--allow-errors", action="store_true",
                        help="有请求失败也继续（默认失败即退出 1，且不更新基线）")
    args = parser.parse_args()

    token = os.environ.get("EVAL_TOKEN", "").strip()
    if not token:
        sys.exit(
            "❌ 缺少 EVAL_TOKEN。\n"
            "   推荐用 tools/eval/run-replay.sh（会自动在容器内签一个 admin token）\n"
            "   或手动：EVAL_TOKEN=<admin jwt> python3 tools/eval/replay.py"
        )

    cases = load_cases(Path(args.golden))
    if args.tag:
        cases = [c for c in cases if args.tag in (c.get("tags") or [])]
    if args.limit:
        cases = cases[: args.limit]
    if not cases:
        sys.exit("❌ 过滤后没有题目")

    print(f"▶ 回放 {len(cases)} 题 → {args.base_url}")
    records = []
    for i, case in enumerate(cases, 1):
        outcome = classify(args.base_url, token, case["input"])
        record = {**case, **outcome}
        records.append(record)

        mark = "✅" if record["predicted"] == case["expect"] else "❌"
        if args.verbose or mark == "❌":
            print(
                f"  {mark} [{case['id']}] {case['input']}  期望={case['expect']} "
                f"预测={record['predicted']} ({record['latency_ms']}ms)"
                + (f"  err={record['error']}" if record["error"] else "")
            )
        else:
            print(f"  {mark} [{i}/{len(cases)}] {case['id']}", end="\r")

        if args.delay > 0 and i < len(cases):
            time.sleep(args.delay)

    print()
    metrics = compute_metrics(records)

    baseline = None
    if BASELINE.exists():
        baseline = json.loads(BASELINE.read_text(encoding="utf-8"))
    comparison = compare_with_baseline(metrics, baseline)

    result = {
        "run_at": datetime.now().isoformat(timespec="seconds"),
        "base_url": args.base_url,
        "golden_file": os.path.relpath(args.golden, EVAL_DIR),
        "metrics": metrics,
        "comparison": comparison,
        "records": records,
    }

    json_path, md_path = write_report(result, REPORT_DIR)

    print(f"\n准确率 {pct(metrics['accuracy'])}  macro-F1 {pct(metrics['macro_f1'])}  "
          f"({metrics['correct']}/{metrics['total']})")
    if comparison["has_baseline"]:
        print(f"对比基线：准确率 {comparison['delta_accuracy'] * 100:+.1f}pp，"
              f"macro-F1 {comparison['delta_macro_f1'] * 100:+.1f}pp")
    print(f"报告：{md_path}")

    if args.update_baseline:
        if metrics["errors"] and not args.allow_errors:
            print("⛔ 有请求失败，拒绝更新基线（修好网络/限流后重跑）")
        else:
            BASELINE.write_text(
                json.dumps(
                    {
                        "run_at": result["run_at"],
                        "golden_file": result["golden_file"],
                        "total": metrics["total"],
                        "accuracy": metrics["accuracy"],
                        "macro_f1": metrics["macro_f1"],
                        "per_domain": metrics["per_domain"],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            print(f"✅ 基线已更新：{BASELINE}")

    # 有任何请求失败 → 这次结果不可信，直接判失败
    if metrics["errors"] and not args.allow_errors:
        print(f"❌ {metrics['errors']} 条请求失败，结果不可作为基线")
        return 1

    # 门槛：显式给了用显式值，否则用「基线 - 2pp」，没有基线时不拦
    threshold = args.fail_under
    if threshold is None and comparison["has_baseline"]:
        threshold = max(0.0, (comparison.get("baseline_accuracy") or 0) - 0.02)
    if threshold is not None and metrics["accuracy"] < threshold:
        print(f"❌ 准确率 {pct(metrics['accuracy'])} 低于门槛 {pct(threshold)}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
