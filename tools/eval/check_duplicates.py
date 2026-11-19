#!/usr/bin/env python3
"""
评测集查重（ai-quality-loop 1.3 / 1.4）
============================================================

为什么要有硬门禁
------------------------------------------------------------
题集里出现一条和「线上例句库」几乎一样的句子，等于提前把答案告诉
分类器：分数会虚高，且改代码后的对比失去意义。宁可回放跑不起来，
也不要一个骗自己的数字。

两层判定
------------------------------------------------------------
1. 精确重复：规范化后完全相同（去空白、标点、大小写）。
2. 近似重复：difflib 相似度 >= 阈值（默认 0.9）。
   近似只是"疑似"，但默认也作为门禁；可以用 --max-similarity 放宽。

比对对象
------------------------------------------------------------
- 题集内部查重（总是执行）。
- 线上例句库（可选）：传 --against-api 时调用
  GET /admin/intent-examples，需要 EVAL_TOKEN。

用法
------------------------------------------------------------
  python3 tools/eval/check_duplicates.py
  EVAL_TOKEN=xxx python3 tools/eval/check_duplicates.py --against-api
  python3 tools/eval/check_duplicates.py --max-similarity 0.95

退出码：0 = 通过；1 = 有重复（回放前应拒绝执行）。
"""

from __future__ import annotations

import argparse
import difflib
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent
GOLDEN = EVAL_DIR / "golden" / "intent.jsonl"
DEFAULT_BASE_URL = "http://localhost/api/v1"
REQUEST_TIMEOUT_SEC = 30


def normalize(text: str) -> str:
    """去掉标点/空白并转小写，只保留可用于比较的字符。"""
    return "".join(ch for ch in text.lower() if ch.isalnum())


def load_golden(path: Path) -> list[dict]:
    cases = []
    with path.open(encoding="utf-8") as f:
        for lineno, raw in enumerate(f, 1):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            try:
                cases.append(json.loads(line))
            except json.JSONDecodeError as e:
                sys.exit(f"❌ {path}:{lineno} 不是合法 JSON：{e}")
    return cases


def load_remote_examples(base_url: str, token: str) -> list[dict]:
    """拉取线上例句库 → [{domain, text}]。接口不可用时抛错，不静默跳过。"""
    url = f"{base_url.rstrip('/')}/admin/intent-examples"
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {token}"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SEC) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:200]
        raise RuntimeError(f"GET {url} -> HTTP {e.code}: {detail}") from e

    groups = payload.get("data", payload) if isinstance(payload, dict) else payload
    rows: list[dict] = []
    for group in groups or []:
        domain = group.get("domain") or group.get("intent") or "unknown"
        for item in group.get("examples") or group.get("sentences") or []:
            text = item.get("text") if isinstance(item, dict) else item
            if isinstance(text, str) and text.strip():
                rows.append({"domain": domain, "text": text})
    return rows


def find_issues(
    cases: list[dict],
    other: list[dict],
    max_similarity: float,
) -> list[dict]:
    """
    返回问题列表。other 的每条是 {source, input, expect?}。
    同一对只报一次；精确重复与近似重复分开标记。
    """
    issues: list[dict] = []

    # 题集内部
    seen: dict[str, dict] = {}
    for case in cases:
        key = normalize(case["input"])
        if key in seen:
            issues.append(
                {
                    "kind": "exact",
                    "source": "golden",
                    "a_id": seen[key]["id"],
                    "a": seen[key]["input"],
                    "b_id": case["id"],
                    "b": case["input"],
                }
            )
        else:
            seen[key] = case

    # 近似：题集内部 + 与外部
    pool = [
        {"source": "golden", "id": c["id"], "input": c["input"]} for c in cases
    ] + [
        {"source": o["source"], "id": o.get("id", "-"), "input": o["input"]}
        for o in other
    ]
    for i in range(len(pool)):
        for j in range(i + 1, len(pool)):
            a, b = pool[i], pool[j]
            if a["source"] == "golden" and b["source"] == "golden":
                # 同一对题集样本；精确重复上面已经报过
                if normalize(a["input"]) == normalize(b["input"]):
                    continue
            ratio = difflib.SequenceMatcher(
                None, normalize(a["input"]), normalize(b["input"])
            ).ratio()
            if ratio >= max_similarity:
                issues.append(
                    {
                        "kind": "similar",
                        "source": f"{a['source']}↔{b['source']}",
                        "a_id": a["id"],
                        "a": a["input"],
                        "b_id": b["id"],
                        "b": b["input"],
                        "similarity": round(ratio, 3),
                    }
                )
    return issues


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--golden", type=Path, default=GOLDEN)
    parser.add_argument("--base-url", default=os.getenv("EVAL_BASE_URL", DEFAULT_BASE_URL))
    parser.add_argument("--against-api", action="store_true")
    parser.add_argument("--max-similarity", type=float, default=0.9)
    args = parser.parse_args()

    cases = load_golden(args.golden)
    print(f"题集：{args.golden}（{len(cases)} 条）")

    other: list[dict] = []
    if args.against_api:
        token = os.getenv("EVAL_TOKEN")
        if not token:
            print("❌ --against-api 需要 EVAL_TOKEN")
            return 1
        try:
            remote = load_remote_examples(args.base_url, token)
        except Exception as e:  # noqa: BLE001 —— 门禁必须把失败当失败
            print(f"❌ 拉取线上例句库失败：{e}")
            return 1
        print(f"线上例句库：{len(remote)} 条")
        other = [
            {"source": "db", "input": r["text"], "id": f"{r['domain']}"}
            for r in remote
        ]

    issues = find_issues(cases, other, args.max_similarity)

    # DB 内部的重复不是「题集泄题」，只提示不阻断；
    # 阻断的只有 golden↔golden / golden↔db（那才会让分数虚高）。
    blocking = [
        i for i in issues
        if i["source"] in ("golden", "golden↔db", "db↔golden")
    ]
    warnings = [i for i in issues if i not in blocking]

    if warnings:
        print(f"\n⚠️  线上例句库内部有 {len(warnings)} 处重复（不阻断回放）：")
        for it in warnings:
            print(f"  [库内] {it['a']} / {it['b']}")

    if not blocking:
        print("✅ 题集未发现泄题（精确 0，与例句库近似 0）")
        return 0

    print(f"\n❌ 发现 {len(blocking)} 处题集重复/近似：\n")
    issues = blocking
    for it in issues:
        if it["kind"] == "exact":
            print(f"[精确] {it['a_id']} ↔ {it['b_id']}: {it['a']}")
        else:
            print(
                f"[近似 {it['similarity']}] {it['source']} "
                f"{it['a_id']} ≈ {it['b_id']}: {it['a']} / {it['b']}"
            )
    print("\n回放前请先替换或删除这些样本。")
    return 1


if __name__ == "__main__":
    sys.exit(main())
