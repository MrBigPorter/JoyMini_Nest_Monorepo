#!/usr/bin/env python3
"""
追加 Taglish/英文真实用户问法到 intent_examples（E-17 修复）

为什么需要：
- 意图样例库以中文/英文书面语为主，真实用户说 Taglish；
- 评测显示真实问法准确率只有 62.8%，操作类问法大量落到 rag/general。

做法：
- 只做 append，不 replace（保留线上已有例句）；
- 每个域 6~8 条，包含操作、状态、规则边界；
- 服务端按文本去重、生成 embedding、同步 Meili。

用法：
  EVAL_TOKEN=<admin jwt> python3 tools/eval/seed-realistic-intent-examples.py
  EVAL_TOKEN=... python3 tools/eval/seed-realistic-intent-examples.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

DEFAULT_BASE_URL = "http://localhost/api/v1"

EXAMPLES: dict[str, list[str]] = {
    "order": [
        "saan na ang package ko",
        "pwede bang i-cancel ang order kahit bayad na",
        "kulang ang laman ng parcel na dumating",
        "delayed na naman ang order ko",
        "wala pa rin ang parcel ko",
        "hindi pa dumarating ang parcel",
        "naiwan ang parcel sa labas",
        "iniwan lang ng rider sa labas ng bahay",
        "nasira ang item pagdating",
        "sira ang dumating na item",
        "palitan ang delivery address",
        "baguhin ang address ng delivery",
        "paano i-track ang delivery ko",
        "maling size ang dumating sa order ko",
        "refund ko hanggang ngayon wala pa",
        "hindi pa dumarating ang inorder ko",
    ],
    "wallet": [
        "ilan ang laman ng wallet ko",
        "paano mag cash in sa wallet",
        "hindi nag-reflect ang top up ko",
        "pending pa rin ang withdrawal ko",
        "magkano ang naka-hold sa account ko",
        "paano mag-withdraw sa GCash",
        "saan makikita ang transaction history ko",
        "paano tingnan ang aking statement",
        "saan nakikita ang mga bayad ko",
        "saan ang payment history",
        "tingnan ang mga bayad",
        "magkano ang frozen balance",
        "magkano ang naka-hold",
    ],
    "coupon": [
        "anong coupon ang pwede ko gamitin",
        "paano i-claim ang voucher",
        "expired na ba ang coupon ko",
        "may discount ba ako ngayon",
        "pagsamahin ang voucher at promo",
        "paano gamitin ang coupon code",
        "babalik ba ang coupon kapag nag-cancel ng order",
        "may coupon pa ba pagkatapos ng refund",
    ],
    "user": [
        "paano baguhin ang password",
        "palitan ang phone number na naka-link",
        "i-update ang profile picture ko",
        "na-hack ang account ko, paano",
        "paano i-unlink ang Facebook",
        "saan makikita ang account settings",
        "ano ang VIP level ko",
        "paano mag-logout sa lahat ng device",
        "i-log out ang ibang device",
        "hindi ko ma-access ang account ko",
        "hindi ako makapasok sa account",
        "i-update ang birthday ko",
        "palitan ang birthday sa profile",
        "ano ang email na naka-link sa account ko",
        "paano i-deactivate ang account ko",
        "paano isara ang account",
    ],
    "product": [
        "meron bang ganitong bag",
        "ano ang size chart ng item",
        "legit ba ang item na ito",
        "paano mag-review ng binili",
        "may stock pa ba ang product",
        "magkano ang item na ito",
        "ano ang difference ng dalawang ito",
        "pakita ang mga review ng item",
        "pwede bang ipa-engrave ang pangalan",
        "may customization ba ang product",
        "available pa ba ito",
        "may available pang stock",
        "pwede bang bumili ng marami",
        "may wholesale ba",
        "ano ang material ng item",
        "gawa saan ang item",
    ],
    "lucky-draw": [
        "may raffle ticket ba ako",
        "paano sumali sa raffle",
        "kailan ang bunot ng premyo",
        "paano kunin ang napanalunan",
        "ilang ticket ang meron ako",
        "kailan ipapadala ang premyo",
        "kailan ipapadala ang napanalunan",
        "expired na ang premyo ko, ano gagawin",
        "may napanalunan ba ako",
        "nanalo ba ako",
        "hindi pa natatanggap ang premyo",
        "wala pa ang premyo ko",
        "paano dumami ang raffle entries",
        "paano makakuha ng mas maraming ticket",
        "saan makikita ang mga ticket ko",
        "hindi pa dumarating ang napanalunan ko",
        "wala pa ang napanalunan ko",
    ],
    "kyc": [
        "verified na ba ako",
        "paano mag-verify ng ID",
        "rejected ang verification ko",
        "hindi ma-upload ang selfie ko",
        "ano ang status ng KYC ko",
        "paano ayusin ang facial recognition",
        "pumapalya ang facial recognition",
        "naglo-load lang ang verification page",
        "tapos na ba ang pag-verify ko",
        "verified na ba ang account ko",
        "hindi matanggap ang ID ko",
        "laging failed ang pag-upload ng ID",
        "naipasa ko na ba ang KYC",
        "pumasa ba ako sa KYC",
    ],
    "rag": [
        "ano ang refund policy",
        "gaano katagal ang delivery",
        "sino ang nagbabayad ng return shipping",
        "ano ang rules sa sale",
        "paano i-return ang item",
        "ano ang privacy policy",
        "magkano ang withdrawal fee",
        "ano ang rules ng coupon",
        "ano ang mga benefit ng VIP",
        "ano ang warranty policy",
        "paano kinakalkula ang seven-day return",
        "paano kinakalkula ang membership level",
        "ano ang rules ng membership level",
        "ano ang rules sa paggamit ng coupon",
        "paano kinakalkula ang withdrawal fee",
        "paano ginagamit ang personal information",
        "ano ang refund process",
        "may bayad ba ang pag-withdraw",
        "ilang araw ang delivery",
        "gaano katagal bago dumating",
        "may kaltas ba sa refund",
        "bawas ba ang refund",
    ],
    "general": [
        "hi",
        "magandang umaga",
        "salamat sa tulong",
        "pwede mo ba akong tulungan",
        "ano ang ginagawa mo",
        "hello po",
        "sino ka ba",
        "ano ang pangalan mo",
        "robot ka ba",
        "kumusta ka",
        "paano kita magagamit",
        "paano ka gamitin",
    ],
}


# 中文口语变体：边界题（操作 vs 规则）和长尾问法。
# 与 Taglish 集分开提交，方便统计两边的增量。
ZH_EXAMPLES: dict[str, list[str]] = {
    "order": [
        "物流显示签收了可是没收到货",
        "快递说已送达但我没拿到",
        "退款进度在哪里看",
        "我的退款到哪一步了",
    ],
    "wallet": [
        "交易记录在哪里查看",
        "怎么查看我的流水",
        "账单明细在哪里",
    ],
    "coupon": [
        "取消订单后优惠券会退回吗",
        "退货后优惠券还在吗",
    ],
    "kyc": [
        "实名认证通过了吗",
        "认证状态怎么样",
        "人脸识别一直失败",
        "认证页面一直转圈",
    ],
    "lucky-draw": [
        "奖品什么时候发货",
        "中奖的奖品多久寄出",
        "奖品过期了怎么处理",
        "怎么增加抽奖次数",
        "怎么获得更多抽奖机会",
    ],
    "product": [
        "帮我看看商品评论",
        "这个宝贝的评价怎么样",
        "商品评价在哪里看",
        "可以刻字吗",
        "支持定制吗",
    ],
    "rag": [
        "七天无理由的时间怎么计算",
        "会员等级是怎么计算的",
        "会员等级的规则是什么",
        "优惠券的使用规则是什么",
        "提现手续费是怎么计算的",
        "个人信息会被怎么使用",
        "退款流程是什么",
    ],
    "general": [
        "你是谁",
        "你的名字是什么",
    ],
}


def put_append(base_url: str, token: str, domain: str, sentences: list[str]) -> dict:
    url = f"{base_url.rstrip('/')}/admin/intent-examples/{domain}"
    body = json.dumps({"sentences": sentences, "mode": "append"}).encode()
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
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", "replace")[:400]
        raise SystemExit(f"PUT {domain} failed: {err.code} {detail}") from err


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default=os.environ.get("EVAL_BASE_URL", DEFAULT_BASE_URL))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.dry_run:
        for label, examples in (("Taglish", EXAMPLES), ("中文", ZH_EXAMPLES)):
            print(f"== {label} ==")
            for domain, sentences in examples.items():
                print(f"[{domain}] +{len(sentences)}")
                for sentence in sentences:
                    print(f"  - {sentence}")
        return

    token = os.environ.get("EVAL_TOKEN", "").strip()
    if not token:
        sys.exit("EVAL_TOKEN is required")

    total = 0
    # 每个域只发一次 append：不同语言的列表先合并。
    # 同一域连续两次 append 会各自 fire-and-forget 一次 Meili 全量重写，
    # 两次任务交错时后一次会把前一次刚写入的句子删掉（实测丢过 4 条）。
    merged: dict[str, list[str]] = {}
    for examples in (EXAMPLES, ZH_EXAMPLES):
        for domain, sentences in examples.items():
            merged.setdefault(domain, [])
            for sentence in sentences:
                if sentence not in merged[domain]:
                    merged[domain].append(sentence)

    for domain, sentences in merged.items():
        result = put_append(args.base_url, token, domain, sentences)
        # 全局响应拦截器把业务字段包在 data 里：{ code, message, data: { domain, count } }
        payload = result.get("data") if isinstance(result.get("data"), dict) else result
        added = payload.get("count") or payload.get("added") or payload.get("addedCount")
        total += int(added or 0)
        print(f"[{domain}] submitted={len(sentences)} added={added}")
    print(f"\ndone: {total} new sentences appended")


if __name__ == "__main__":
    main()
