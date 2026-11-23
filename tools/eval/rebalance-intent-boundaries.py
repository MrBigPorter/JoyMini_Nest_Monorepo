#!/usr/bin/env python3
"""
重划意图例句边界：操作类问题归业务域，政策类留在 rag（E-17 根因修复）

背景：
- intent_examples 的 rag 域里混入了大量“操作类”问句：
    "How do I change my password?" / "How do I withdraw funds?"
    "How do I join the lucky draw?" / "Why was my KYC rejected?"
- rag 例句又多（149 条），向量中心非常宽，用户说 Taglish 时几乎
  任何 "paano ..." 都会先命中 rag，业务 Agent 根本拿不到意图。

边界定义：
- 操作/状态/进度（我要做某事、我的某事怎么样了）→ 具体业务域
- 政策/规则/费用/限额/流程/条件（能不能、多少钱、需要什么）→ rag

做法：
- 通过管理 API 执行，保持 embedding + Meili 索引同步；
- rag 用 replace（移除迁出的句子），目标域用 append；
- 幂等：迁出的句子已不在 rag 时自动跳过，append 由服务端去重。

用法：
  EVAL_TOKEN=<admin jwt> python3 tools/eval/rebalance-intent-boundaries.py
  EVAL_TOKEN=... python3 tools/eval/rebalance-intent-boundaries.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

DEFAULT_BASE_URL = "http://localhost/api/v1"

# 按“源域 → 目标域 → 句子”组织，便于从任意域迁出操作类/规则类错位例句。
# 当前只有两处源域：rag（操作类错位）和 wallet（费率类错位）。
MOVES_BY_SOURCE: dict[str, dict[str, list[str]]] = {
    "rag": {
        "wallet": [
            "Can I withdraw money?",
            "How do I withdraw funds?",
            "Can I withdraw to my bank account?",
        ],
        "user": [
            "How do I change my password?",
            "How do I change my name?",
        ],
        "lucky-draw": [
            "How do I join the lucky draw?",
            "How to join the raffle?",
            "How do I claim my prize?",
            "I won but did not receive my prize",
        ],
        "kyc": [
            "How do I complete KYC?",
            "Why was my KYC rejected?",
            "How long has my KYC been pending?",
            "My KYC has been pending for days",
            "When will my verification be complete?",
            "Why is my KYC taking so long?",
        ],
        "coupon": [
            "How do I use a coupon?",
        ],
        "order": [
            "How do I request a refund?",
            "How do I return a product?",
            "Can I get a refund for this?",
        ],
    },
    # 费率属于规则口径 → rag；第一轮补例句时误放进 wallet，导致
    # "magkano ang bayad sa pag-withdraw" 被判成 wallet。
    "wallet": {
        "rag": [
            "may bayad ba ang pag-withdraw",
        ],
    },
}

# 第二轮真实问法（错误/口语/Taglish），与评测题集不重复
EXTRA: dict[str, list[str]] = {
    "order": [
        "nasan na ang order ko",
        "order ko hindi pa dumarating",
        "hindi ko makita ang order ko",
        "asan na ang inorder ko",
    ],
    "wallet": [
        "nag-deposit ako pero wala sa balance",
        "hindi pumasok ang cash in ko",
        "paano mag top up",
        "pwede bang mag cash in",
    ],
    "coupon": [
        "pwede bang pagsamahin ang discount at sale",
        "may sale at coupon ba",
        "paano makakuha ng voucher",
    ],
    "user": [
        "paano palitan ang password",
        "gusto kong magpalit ng password",
        "hindi ko ma-change ang password",
    ],
    "kyc": [
        "bakit na-reject ang KYC ko",
        "pending pa rin ang KYC ko",
    ],
    "lucky-draw": [
        "paano makasali sa lucky draw",
        "paano mag-join sa raffle",
        "paano i-claim ang premyo",
        "nanalo ako pero wala ang premyo",
    ],
    "general": [
        "sino ka",
        "ano ang pangalan mo",
        "bot ka ba",
        "kumusta",
    ],
    "rag": [
        "ano ang rules ng lucky draw",
        "may bayad ba ang withdrawal",
        "paano gumagana ang flash sale",
        "ano ang mga dokumento para sa KYC",
        "gaano katagal ang KYC approval",
    ],
}


def api(path: str, token: str, method: str = "GET", body: dict | None = None):
    url = f"{DEFAULT_BASE_URL.rstrip('/')}{path}"
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Authorization": f"Bearer {token}"}
    if data:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            payload = json.loads(resp.read().decode())
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", "replace")[:400]
        raise SystemExit(f"{method} {path} failed: {err.code} {detail}") from err
    return payload.get("data") if isinstance(payload.get("data"), dict) else payload


def get_examples(domain: str, token: str) -> list[str]:
    data = api(f"/admin/intent-examples/{domain}", token)
    return list(data.get("examples") or [])


def put(domain: str, sentences: list[str], mode: str, token: str) -> int:
    data = api(
        f"/admin/intent-examples/{domain}",
        token,
        method="PUT",
        body={"sentences": sentences, "mode": mode},
    )
    return int(data.get("count") or 0)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    token = os.environ.get("EVAL_TOKEN", "").strip()
    if not token and not args.dry_run:
        sys.exit("EVAL_TOKEN is required")

    if args.dry_run:
        print("== 迁出错位例句 ==")
        for source, moves in MOVES_BY_SOURCE.items():
            for target, sentences in moves.items():
                print(f"[{source} → {target}] {len(sentences)}")
                for sentence in sentences:
                    print(f"  - {sentence}")
        print("== 新增真实问法 ==")
        for domain, sentences in EXTRA.items():
            print(f"[{domain}] +{len(sentences)}")
            for sentence in sentences:
                print(f"  - {sentence}")
        return

    # 先一次性算出每个域的最终例句集合，再决定 append / replace。
    # 不能对同一个域先 replace 再 append：replace 是“先删行、再异步生成
    # embedding”，删完到写完之间表里是空的，append 会把本该去重的句子
    # 当成新句子重复插入（本轮实测 wallet 出现 15 组重复）。
    domains = (
        set(MOVES_BY_SOURCE)
        | {target for moves in MOVES_BY_SOURCE.values() for target in moves}
        | set(EXTRA)
    )
    current = {domain: get_examples(domain, token) for domain in domains}
    final: dict[str, list[str]] = {
        domain: list(dict.fromkeys(current[domain])) for domain in domains
    }

    for source, moves in MOVES_BY_SOURCE.items():
        for target, sentences in moves.items():
            removed = set(sentences)
            final[source] = [s for s in final[source] if s not in removed]
            for sentence in sentences:
                if sentence not in final[target]:
                    final[target].append(sentence)

    for domain, sentences in EXTRA.items():
        for sentence in sentences:
            if sentence not in final[domain]:
                final[domain].append(sentence)

    for domain in sorted(domains):
        before = current[domain]
        after = final[domain]
        before_set, after_set = set(before), set(after)
        has_duplicates = len(before) != len(before_set)
        adds = after_set - before_set
        removes = before_set - after_set

        if not adds and not removes and not has_duplicates:
            print(f"[{domain}] unchanged ({len(after)})")
            continue

        if adds and not removes and not has_duplicates:
            # 纯新增：append 保留现有向量，只给新句子生成 embedding
            count = put(domain, sorted(adds), "append", token)
            print(f"[{domain}] append: added={count}")
        else:
            # 有删除或历史重复：整体 replace，一次写对
            count = put(domain, after, "replace", token)
            print(
                f"[{domain}] replace: {len(before)} → {len(after)} "
                f"(removed={len(removes)}, added={len(adds)}, dupes={has_duplicates}, jobs={count})"
            )


if __name__ == "__main__":
    main()
