#!/usr/bin/env python3
"""
把代码里已有的中文示例补进 intent_examples（本地开发/一次性运维工具）
============================================================

背景
------------------------------------------------------------
`agents/prompts/intent-examples/*.ts` 是 seed 数据，中英混排；
但线上/本地库里的 intent_examples 实际只有英文（历史后台 replace 覆盖）。
中文查询靠跨语言 embedding 硬匹配，kyc/wallet/product 因此召回很低。

这个脚本只做一件事：从 TS seed 里抽出**中文句子**，按 domain 追加到
`PUT /admin/intent-examples/:domain`（mode=append，服务端按文本去重并重新生成向量）。

为什么用 append 而不是 replace：
- 不删除线上可能由客服维护的英文例句；
- 重复执行安全（服务端去重）。

用法
------------------------------------------------------------
  EVAL_TOKEN=<admin jwt> python3 tools/eval/seed-zh-examples.py
  EVAL_TOKEN=... python3 tools/eval/seed-zh-examples.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXAMPLES_DIR = (
    ROOT
    / "apps/api/src/client/ai-customer/graph/agents/prompts/intent-examples"
)
DEFAULT_BASE_URL = "http://localhost/api/v1"
CJK = re.compile(r"[一-鿿]")
STRING_LITERAL = re.compile(r"'((?:[^'\\]|\\.)*)'|\"((?:[^\"\\]|\\.)*)\"")


def extract_chinese(domain: str) -> list[str]:
    path = EXAMPLES_DIR / f"{domain}.ts"
    if not path.exists():
        return []
    text = path.read_text(encoding="utf-8")
    # 只取 export const ... = [ ... ]; 之间的内容，避免注释里的中文
    start = text.find("= [")
    end = text.find("];", start)
    if start < 0 or end < 0:
        return []
    body = text[start:end]
    # 去掉行注释：注释里可能有英文撇号（如 user's），会把字符串正则带偏
    body = re.sub(r"//[^\n]*", "", body)

    seen: set[str] = set()
    result: list[str] = []
    for m in STRING_LITERAL.finditer(body):
        value = m.group(1) or m.group(2) or ""
        value = value.strip()
        if not value or not CJK.search(value):
            continue
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def put_append(base_url: str, token: str, domain: str, sentences: list[str]) -> dict:
    url = f"{base_url.rstrip('/')}/admin/intent-examples/{domain}"
    body = json.dumps({"sentences": sentences, "mode": "append"}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="PUT",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        raise RuntimeError(f"PUT {url} -> HTTP {e.code}: {detail}") from e


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default=os.getenv("EVAL_BASE_URL", DEFAULT_BASE_URL))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    token = os.getenv("EVAL_TOKEN", "").strip()
    if not token and not args.dry_run:
        print("❌ 需要 EVAL_TOKEN（角色至少 ADMIN）")
        return 1

    files = sorted(p.stem for p in EXAMPLES_DIR.glob("*.ts") if p.stem != "index")
    total = 0
    for domain in files:
        sentences = extract_chinese(domain)
        if not sentences:
            continue
        print(f"{domain}: {len(sentences)} 条中文示例")
        if args.dry_run:
            for s in sentences:
                print(f"  + {s}")
            continue
        result = put_append(args.base_url, token, domain, sentences)
        data = result.get("data", result)
        print(
            f"  → 服务端: 新增 {data.get('added', '?')} / "
            f"待重嵌入 {data.get('submitted', data.get('submittedCount', '?'))}"
        )
        total += len(sentences)

    if not args.dry_run:
        print(f"\n完成：提交 {total} 条中文示例。向量由 embedding 队列异步生成。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
