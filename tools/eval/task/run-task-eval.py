#!/usr/bin/env python3
"""
任务成功率评测（ai-quality-loop 3.x / 6.2）
================================================

对每条带 `expectTask` 的题：
  1. 用 client token 调真实 `/ai/customer/test-chat`，拿 AI 回答与确认卡片
  2. 用 admin token 调 `/admin/ai-eval/judge`，由不同厂商模型判 solved/partial/unsolved
  3. 汇总：任务成功率、分意图明细、judge 与人工标注的一致率

与 replay.py 的分工：
  - replay.py 只测「意图分类」
  - 本脚本测「问题是否被解决」，回答质量由 judge 评

用法：
  tools/eval/task/run-task-eval.sh                  # 推荐（自动签两个 token）
  EVAL_TOKEN=... EVAL_CLIENT_TOKEN=... python3 tools/eval/task/run-task-eval.py

只用标准库。
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
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent
DEFAULT_GOLDEN = EVAL_DIR / "golden.jsonl"
DEFAULT_MANUAL = EVAL_DIR / "manual-labels.jsonl"
REPORT_DIR = EVAL_DIR / "reports"
DEFAULT_BASE_URL = "http://localhost/api/v1"
REQUEST_TIMEOUT_SEC = 120
MAX_429_RETRIES = 4
DEFAULT_DELAY_SEC = 0.3


def load_golden(path: Path) -> list[dict]:
    cases = []
    for lineno, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        try:
            case = json.loads(line)
        except json.JSONDecodeError as e:
            sys.exit(f"❌ {path}:{lineno} 不是合法 JSON：{e}")
        for key in ("id", "input", "expect", "expectTask"):
            if key not in case:
                sys.exit(f"❌ {path}:{lineno} 缺少字段 {key}")
        cases.append(case)
    return cases


def post_json(base_url: str, token: str, path: str, payload: dict) -> dict:
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}{path}",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    for attempt in range(MAX_429_RETRIES + 1):
        try:
            with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SEC) as resp:
                body = json.loads(resp.read().decode("utf-8"))
            return body
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:300]
            if e.code == 429 and attempt < MAX_429_RETRIES:
                wait = int(e.headers.get("Retry-After") or 60)
                print(f"    ⏳ 429 限流，等待 {wait}s 后重试")
                time.sleep(wait)
                continue
            raise RuntimeError(f"HTTP {e.code}: {detail}")
    raise RuntimeError("unreachable")


def unwrap(body: dict) -> dict:
    if body.get("code") not in (None, 10000):
        raise RuntimeError(f"API error: {body}")
    return body.get("data") or {}


def percentile(values: list[int], p: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    return ordered[max(0, min(len(ordered) - 1, int(len(ordered) * p) - 1))]


def load_manual(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    labels: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        item = json.loads(line)
        if item.get("id") and item.get("verdict"):
            labels[item["id"]] = item["verdict"]
    return labels


def main() -> int:
    parser = argparse.ArgumentParser(description="任务成功率评测")
    parser.add_argument("--base-url", default=os.environ.get("EVAL_BASE_URL", DEFAULT_BASE_URL))
    parser.add_argument("--golden", default=str(DEFAULT_GOLDEN))
    parser.add_argument("--manual-labels", default=str(DEFAULT_MANUAL))
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--delay", type=float, default=DEFAULT_DELAY_SEC)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--collect-only",
        action="store_true",
        help="只收集 test-chat 回答，不调用 judge（供人工独立标注）",
    )
    parser.add_argument(
        "--transcripts",
        default=None,
        help="跳过 test-chat，直接对已收集的 transcripts.json 判分",
    )
    args = parser.parse_args()

    cases = load_golden(Path(args.golden))
    if args.limit:
        cases = cases[: args.limit]
    if not cases:
        sys.exit("❌ 没有可跑的题")
    if args.dry_run:
        print(f"✓ 任务题集可读：{len(cases)} 条，文件 {args.golden}")
        return 0

    client_token = os.environ.get("EVAL_CLIENT_TOKEN", "").strip()
    admin_token = os.environ.get("EVAL_TOKEN", "").strip()
    if args.transcripts:
        if not admin_token:
            sys.exit("❌ 缺少 EVAL_TOKEN（判分需要 admin token）")
    elif args.collect_only:
        if not client_token:
            sys.exit("❌ 缺少 EVAL_CLIENT_TOKEN（收集回答需要 client token）")
    elif not client_token or not admin_token:
        sys.exit(
            "❌ 缺少 EVAL_CLIENT_TOKEN / EVAL_TOKEN。\n"
            "   推荐用 tools/eval/task/run-task-eval.sh（自动签两个 token）"
        )

    cases_by_id = {c["id"]: c for c in cases}
    records: list[dict] = []

    if args.transcripts:
        raw = json.loads(Path(args.transcripts).read_text(encoding="utf-8"))
        collected = raw.get("records", raw) if isinstance(raw, dict) else raw
        print(f"▶ 对 {len(collected)} 条已有回答判分（跳过 test-chat）")
        for item in collected:
            case = cases_by_id.get(item["id"])
            if not case:
                continue
            try:
                judge = unwrap(
                    post_json(
                        args.base_url,
                        admin_token,
                        "/admin/ai-eval/judge",
                        {
                            "question": case["input"],
                            "answer": item.get("answer") or "",
                            "expectTask": case["expectTask"],
                            "pendingConfirm": item.get("pendingConfirm"),
                        },
                    )
                )
                records.append({**item, **judge})
            except Exception as e:  # noqa: BLE001
                records.append({**item, "verdict": "error", "score": 0, "reason": str(e)[:300]})
        for i, r in enumerate(records, 1):
            mark = {"solved": "✅", "partial": "◐", "unsolved": "❌"}.get(r["verdict"], "⚠️")
            print(
                f"  {mark} [{r['id']}] {r['verdict']} "
                f"(score={r.get('score')}) {r.get('reason', '')[:60]}"
            )
            if i < len(records):
                time.sleep(args.delay)
    else:
        print(f"▶ 任务评测 {len(cases)} 题 → {args.base_url}")
        for i, case in enumerate(cases, 1):
            session_id = f"task-eval-{uuid.uuid4()}"
            try:
                chat = unwrap(
                    post_json(
                        args.base_url,
                        client_token,
                        "/ai/customer/test-chat",
                        {"message": case["input"], "sessionId": session_id, "debug": False},
                    )
                )
                item = {
                    "id": case["id"],
                    "input": case["input"],
                    "expect": case.get("expect"),
                    "intent": chat.get("intent"),
                    "answer": chat.get("agentOutput") or "",
                    "pendingConfirm": chat.get("pendingConfirm"),
                }
                if args.collect_only:
                    records.append(item)
                    print(f"  ✓ [{case['id']}] 已收集回答")
                else:
                    judge = unwrap(
                        post_json(
                            args.base_url,
                            admin_token,
                            "/admin/ai-eval/judge",
                            {
                                "question": case["input"],
                                "answer": item["answer"],
                                "expectTask": case["expectTask"],
                                "pendingConfirm": item["pendingConfirm"],
                            },
                        )
                    )
                    records.append({**item, **judge})
            except Exception as e:  # noqa: BLE001 - 单题失败不拖垮整次评测
                records.append(
                    {
                        "id": case["id"],
                        "input": case["input"],
                        "expect": case.get("expect"),
                        "verdict": "error",
                        "score": 0,
                        "reason": str(e)[:300],
                    }
                )
            if i < len(cases):
                time.sleep(args.delay)

        if args.collect_only:
            REPORT_DIR.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            out = REPORT_DIR / f"{stamp}-transcripts.json"
            out.write_text(
                json.dumps({"golden": args.golden, "records": records}, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            print(f"\n✓ 回答已收集：{out}\n  下一步：人工标注后运行 --transcripts {out}")
            return 0

    valid = [r for r in records if r["verdict"] != "error"]
    counts = Counter(r["verdict"] for r in valid)
    total = len(valid)
    solved_rate = counts["solved"] / total if total else 0

    by_intent: dict[str, list[dict]] = defaultdict(list)
    for r in valid:
        by_intent[r.get("expect") or "unknown"].append(r)

    manual = load_manual(Path(args.manual_labels))
    checked = [r for r in valid if r["id"] in manual]
    agree = sum(1 for r in checked if r["verdict"] == manual[r["id"]])
    agreement = agree / len(checked) if checked else None

    now = datetime.now()
    report = {
        "generatedAt": now.isoformat(timespec="seconds"),
        "golden": args.golden,
        "total": len(records),
        "valid": total,
        "errors": len(records) - total,
        "verdicts": dict(counts),
        "solvedRate": round(solved_rate, 4),
        "agreement": None if agreement is None else round(agreement, 4),
        "agreementSamples": len(checked),
        "records": records,
    }

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = now.strftime("%Y%m%d-%H%M%S")
    json_path = REPORT_DIR / f"{stamp}.json"
    md_path = REPORT_DIR / f"{stamp}.md"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        f"# 任务成功率评测（{now.strftime('%Y-%m-%d %H:%M')}）",
        "",
        f"- 题集：`{args.golden}`",
        f"- 样本：{total} 有效 / {len(records)} 总数",
        f"- solved：{counts['solved']}，partial：{counts['partial']}，"
        f"unsolved：{counts['unsolved']}，error：{report['errors']}",
        f"- **任务成功率：{solved_rate:.1%}**",
    ]
    if agreement is not None:
        lines.append(
            f"- judge 与人工标注一致率：{agreement:.1%}"
            f"（{agree}/{len(checked)}，门槛 ≥80%）"
        )
    else:
        lines.append("- judge 与人工标注一致率：未提供 `manual-labels.jsonl`")
    if valid and all(r.get("vendorIndependent") is False for r in valid):
        lines.append(
            "- ⚠️ judge 与被测模型同厂商（本地临时校准），"
            "结论不能作为正式的不同厂商校准证据"
        )
    lines += ["", "## 分意图", "", "| 意图 | n | solved | partial | unsolved |", "|---|---:|---:|---:|---:|"]
    for intent, rows in sorted(by_intent.items()):
        c = Counter(r["verdict"] for r in rows)
        lines.append(
            f"| {intent} | {len(rows)} | {c['solved']} | {c['partial']} | {c['unsolved']} |"
        )
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print("")
    print("\n".join(lines[3:]))
    print(f"\n报告：{json_path}")
    print(f"      {md_path}")
    return 0 if report["errors"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
