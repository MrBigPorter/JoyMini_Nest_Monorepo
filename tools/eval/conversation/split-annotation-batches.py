#!/usr/bin/env python3
"""把标注工作表拆成小批次，便于分次标注。

用法：
  python3 tools/eval/conversation/split-annotation-batches.py \
    --worksheet tools/eval/conversation/annotations/worksheet-2026-11-21.jsonl \
    --out-dir tools/eval/conversation/annotations/batches \
    --size 10
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="split annotation worksheet")
    parser.add_argument("--worksheet", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--size", type=int, default=10)
    args = parser.parse_args()

    rows = [
        json.loads(line)
        for line in args.worksheet.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.startswith("#")
    ]
    if not rows:
        raise SystemExit("worksheet is empty")

    args.out_dir.mkdir(parents=True, exist_ok=True)
    batches = []
    for index in range(0, len(rows), args.size):
        chunk = rows[index : index + args.size]
        batch_no = index // args.size + 1
        path = args.out_dir / f"batch-{batch_no:02d}.jsonl"
        path.write_text(
            "\n".join(json.dumps(row, ensure_ascii=False) for row in chunk)
            + "\n",
            encoding="utf-8",
        )
        batches.append((path, len(chunk)))

    print(f"[split] rows={len(rows)} size={args.size} batches={len(batches)}")
    for path, count in batches:
        print(f"  {path} ({count} row(s))")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
