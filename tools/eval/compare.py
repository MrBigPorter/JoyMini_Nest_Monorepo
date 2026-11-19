#!/usr/bin/env python3
"""
两次回放的配对显著性检验（ai-quality-loop 2.2 / 2.3）
============================================================

问题
------------------------------------------------------------
改完代码，"准确率从 68.2% 到 70.1%" 能不能说"变好了"？
如果两套结果只是同一批题上的随机波动，这个结论就是错的。

做法
------------------------------------------------------------
同一批题、同一批 id，逐题对比两次预测 → McNemar 配对检验：

                 B 对      B 错
    A 对         a         b
    A 错         c         d

只有 discordant 对（b + c）携带信息：
  - b = A 对 B 错（改后变坏）
  - c = A 错 B 对（改后变好）

样本少时用精确二项检验（不依赖 scipy）：
  p = 2 * Σ_{k=0}^{min(b,c)} C(b+c, k) * 0.5^(b+c)

用法
------------------------------------------------------------
  python3 tools/eval/compare.py reports/A.json reports/B.json
  python3 tools/eval/compare.py A.json B.json --out reports/compare.md

约定
------------------------------------------------------------
- 参数顺序：A = 基线（旧），B = 本次（新）。
- 只比较两次都出现的题；缺失 id 会被列出来，不静默忽略。
"""

from __future__ import annotations

import argparse
import json
import sys
from math import comb
from pathlib import Path


def load_report(path: Path) -> dict[str, dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    records = data.get("records") or []
    if not records:
        sys.exit(f"❌ {path} 里没有 records，无法做配对检验")
    return {r["id"]: r for r in records if r.get("id")}


def mcnemar_exact(b: int, c: int) -> float:
    """双侧精确 McNemar p 值；b = c = 0 时 p = 1。"""
    n = b + c
    if n == 0:
        return 1.0
    tail = sum(comb(n, k) for k in range(0, min(b, c) + 1)) / (2**n)
    return min(1.0, 2 * tail)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("baseline", type=Path, help="A：基线报告 json")
    parser.add_argument("candidate", type=Path, help="B：本次报告 json")
    parser.add_argument("--out", type=Path, help="可选：写一份 markdown")
    args = parser.parse_args()

    a = load_report(args.baseline)
    b = load_report(args.candidate)

    common = sorted(set(a) & set(b))
    only_a = sorted(set(a) - set(b))
    only_b = sorted(set(b) - set(a))

    a_correct = b_correct = 0
    both_correct = both_wrong = 0
    only_a_right = only_b_right = 0

    rows = []
    for cid in common:
        ra, rb = a[cid], b[cid]
        ok_a = ra.get("predicted") == ra.get("expect")
        ok_b = rb.get("predicted") == rb.get("expect")
        a_correct += ok_a
        b_correct += ok_b
        if ok_a and ok_b:
            both_correct += 1
        elif ok_a and not ok_b:
            only_a_right += 1
            rows.append((cid, ra["input"], ra["expect"], ra["predicted"], rb["predicted"], "A 对 → B 错"))
        elif not ok_a and ok_b:
            only_b_right += 1
            rows.append((cid, ra["input"], ra["expect"], ra["predicted"], rb["predicted"], "A 错 → B 对"))
        else:
            both_wrong += 1

    n = len(common)
    if n == 0:
        sys.exit("❌ 两份报告没有共同题 id")

    p = mcnemar_exact(only_a_right, only_b_right)
    acc_a = a_correct / n
    acc_b = b_correct / n

    verdict = "无显著差异"
    if p < 0.05:
        verdict = "B 显著优于 A" if only_b_right > only_a_right else "B 显著劣于 A"

    lines = [
        "# 意图回放配对对比（McNemar）",
        "",
        f"- A（基线）：`{args.baseline}`",
        f"- B（本次）：`{args.candidate}`",
        f"- 共同题数：{n}",
        "",
        "## 总览",
        "",
        "| 指标 | A | B | 变化 |",
        "|---|---|---|---|",
        f"| 准确率 | {acc_a * 100:.1f}% | {acc_b * 100:.1f}% | {(acc_b - acc_a) * 100:+.1f}pp |",
        f"| 答对 | {a_correct} | {b_correct} | {b_correct - a_correct:+d} |",
        "",
        "## 配对表",
        "",
        "| | B 对 | B 错 |",
        "|---|---|---|",
        f"| A 对 | {both_correct} | {only_a_right} |",
        f"| A 错 | {only_b_right} | {both_wrong} |",
        "",
        f"- discordant：A 对 B 错 = {only_a_right}，A 错 B 对 = {only_b_right}",
        f"- 精确 McNemar p = {p:.4f}",
        f"- 结论：**{verdict}**（阈值 0.05）",
    ]

    if only_a or only_b:
        lines += [
            "",
            "## 只出现在一份报告里的题（未参与检验）",
            "",
            f"- 仅 A：{', '.join(only_a) if only_a else '（无）'}",
            f"- 仅 B：{', '.join(only_b) if only_b else '（无）'}",
        ]

    if rows:
        lines += [
            "",
            "## 翻转的题",
            "",
            "| ID | 输入 | 期望 | A 预测 | B 预测 | 方向 |",
            "|---|---|---|---|---|---|",
        ]
        for cid, text, expect, pa, pb, direction in rows:
            lines.append(
                f"| {cid} | {text} | {expect} | {pa or '-'} | {pb or '-'} | {direction} |"
            )

    summary = "\n".join(lines)
    print(summary)

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(summary + "\n", encoding="utf-8")
        print(f"\n已写入 {args.out}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
