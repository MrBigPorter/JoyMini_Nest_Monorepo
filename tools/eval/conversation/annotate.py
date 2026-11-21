#!/usr/bin/env python3
"""人工标注的一致性校验与 kappa 计算。

用法：
  python3 tools/eval/conversation/annotate.py validate --file annotations-a.jsonl
  python3 tools/eval/conversation/annotate.py score \
      --a annotations-a.jsonl --b annotations-b.jsonl \
      --out reports/annotation-kappa.md

输入：export-annotation-worksheet.ts 生成的 JSONL，labels 字段：
  {"correctness": "solved|partial|unsolved|unsafe|abstain",
   "helpfulness": 1-5, "tone_safety": 1-5, "comment": ""}
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

CORRECTNESS = {"solved", "partial", "unsolved", "unsafe", "abstain"}


def load(path: Path) -> dict[str, dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}
    for lineno, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError as exc:
            raise SystemExit(f"{path}:{lineno}: invalid JSON: {exc}") from exc
        key = f"{item.get('caseId')}#{item.get('turn')}"
        if key in rows:
            raise SystemExit(f"{path}:{lineno}: duplicate row {key}")
        rows[key] = item
    return rows


def validate_labels(item: dict[str, Any], where: str) -> list[str]:
    errors: list[str] = []
    labels = item.get("labels")
    if not isinstance(labels, dict):
        return [f"{where}: labels missing"]
    correctness = labels.get("correctness")
    if correctness is not None and correctness not in CORRECTNESS:
        errors.append(f"{where}: invalid correctness {correctness!r}")
    for key in ("helpfulness", "tone_safety"):
        value = labels.get(key)
        if value is not None and (
            not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= 5
        ):
            errors.append(f"{where}: {key} must be 1-5 or null")
    return errors


def cohen_kappa(first: list[Any], second: list[Any]) -> float | None:
    if not first:
        return None
    labels = sorted(set(first) | set(second))
    total = len(first)
    observed = sum(1 for a, b in zip(first, second) if a == b) / total
    expected = 0.0
    for label in labels:
        expected += (first.count(label) / total) * (second.count(label) / total)
    if expected <= 0 or expected >= 1:
        return None
    return (observed - expected) / (1 - expected)


def weighted_kappa(first: list[int], second: list[int], max_rating: int = 5) -> float | None:
    if not first:
        return None
    total = len(first)
    observed = 0.0
    for a, b in zip(first, second):
        observed += ((a - b) ** 2) / ((max_rating - 1) ** 2)
    observed /= total

    def po(label: int) -> float:
        return (first.count(label) + second.count(label)) / (2 * total)

    expected = 0.0
    for a in range(1, max_rating + 1):
        for b in range(1, max_rating + 1):
            expected += po(a) * po(b) * (((a - b) ** 2) / ((max_rating - 1) ** 2))
    if expected <= 0 or expected >= 1:
        return None
    return 1 - observed / expected


def score(path_a: Path, path_b: Path) -> tuple[list[str], list[str]]:
    rows_a = load(path_a)
    rows_b = load(path_b)
    common = sorted(set(rows_a) & set(rows_b))
    lines: list[str] = []
    json_lines: list[str] = []

    lines.append("# 标注一致性报告")
    lines.append("")
    lines.append(f"- A: `{path_a}`（{len(rows_a)} 行）")
    lines.append(f"- B: `{path_b}`（{len(rows_b)} 行）")
    lines.append(f"- 共同行: {len(common)}")
    lines.append("")

    metrics = []
    for key, kind in (
        ("correctness", "categorical"),
        ("helpfulness", "ordinal"),
        ("tone_safety", "ordinal"),
    ):
        pairs = [
            (rows_a[item]["labels"].get(key), rows_b[item]["labels"].get(key))
            for item in common
        ]
        pairs = [(a, b) for a, b in pairs if a is not None and b is not None]
        if kind == "categorical":
            kappa = cohen_kappa([a for a, _ in pairs], [b for _, b in pairs])
        else:
            kappa = weighted_kappa([a for a, _ in pairs], [b for _, b in pairs])
        agreement = (
            sum(1 for a, b in pairs if a == b) / len(pairs) if pairs else None
        )
        metrics.append(
            {
                "key": key,
                "n": len(pairs),
                "agreement": agreement,
                "kappa": kappa,
                "pass": kappa is not None and kappa >= 0.6,
            }
        )

    lines.append("| 维度 | n | 一致率 | kappa | 结论 |")
    lines.append("|---|---:|---:|---:|---|")
    for item in metrics:
        agreement = "—" if item["agreement"] is None else f"{item['agreement']:.1%}"
        kappa = "—" if item["kappa"] is None else f"{item['kappa']:.3f}"
        if item["kappa"] is None:
            conclusion = "n/a（样本无差异或不足）"
        elif item["pass"]:
            conclusion = "PASS"
        else:
            conclusion = "FAIL（<0.6，先改 rubric）"
        lines.append(f"| {item['key']} | {item['n']} | {agreement} | {kappa} | {conclusion} |")
        json_lines.append(json.dumps(item, ensure_ascii=False))

    lines.append("")
    lines.append("规则：kappa <0.6 先改评分表，不调模型；样本 n<30 只作参考。")
    lines.append("")
    return lines, json_lines


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="annotation validation / kappa")
    sub = parser.add_subparsers(dest="command", required=True)

    validate = sub.add_parser("validate")
    validate.add_argument("--file", type=Path, required=True)

    score_cmd = sub.add_parser("score")
    score_cmd.add_argument("--a", type=Path, required=True)
    score_cmd.add_argument("--b", type=Path, required=True)
    score_cmd.add_argument("--out", type=Path)

    args = parser.parse_args(argv)

    if args.command == "validate":
        rows = load(args.file)
        errors: list[str] = []
        for key, item in rows.items():
            errors.extend(validate_labels(item, key))
        if errors:
            for error in errors:
                print(f"ERROR {error}", file=sys.stderr)
            return 1
        print(f"OK annotation: {len(rows)} row(s)")
        return 0

    lines, _ = score(args.a, args.b)
    text = "\n".join(lines) + "\n"
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text, encoding="utf-8")
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
