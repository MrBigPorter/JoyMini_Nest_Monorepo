# 商品与奖励素材上传清单（精简配置版）

> 目标：一次性整理商品上架与奖励展示素材，减少后台手工逐条配置。  
> 对齐时间：2026-03-18。

---

## 一、配置提速建议（先做这 4 件）

1. **统一命名规则**：按 `JM-xxx` 分目录，封面/详情/奖励图固定命名。
2. **先批量上传，再跑 seed**：图片 URL 先准备到 CDN，再将 URL 批量写入 seed。
3. **分类统一单词英文**：`Electronics / Home / Fashion / Sports / Beauty / Cash`。
4. **奖励图独立目录**：`/rewards/` 与 `/products/` 分开，避免后期混淆。

---

## 二、商品素材清单（Treasure）

| seq    | category    | 商品名                            | 封面图 | 详情图建议 | 当前 seed URL（需替换可直接搜）                                   |
| ------ | ----------- | --------------------------------- | ------ | ---------- | ----------------------------------------------------------------- |
| JM-001 | Electronics | Apple iPhone 16 Pro 256GB         | 1 张   | 2-4 张     | `iphone16pro-cover.jpg`, `iphone16pro-1.jpg`, `iphone16pro-2.jpg` |
| JM-002 | Electronics | Samsung Galaxy S25 Ultra 512GB    | 1 张   | 2-4 张     | `s25ultra-cover.jpg`, `s25ultra-1.jpg`, `s25ultra-2.jpg`          |
| JM-003 | Electronics | Sony PlayStation 5 Slim + 3 Games | 1 张   | 2-4 张     | `ps5slim-cover.jpg`, `ps5slim-1.jpg`, `ps5slim-2.jpg`             |
| JM-004 | Home        | Dyson V15 Detect Absolute Vacuum  | 1 张   | 2-3 张     | `dysonv15-cover.jpg`, `dysonv15-1.jpg`                            |
| JM-005 | Fashion     | Nike Air Jordan 4 Retro (US10)    | 1 张   | 2-4 张     | `aj4-cover.jpg`, `aj4-1.jpg`, `aj4-2.jpg`                         |
| JM-006 | Beauty      | Dyson Supersonic HD15 Hair Dryer  | 1 张   | 2-3 张     | `dysonsupersonic-cover.jpg`, `dysonsupersonic-1.jpg`              |
| JM-007 | Cash        | ₱5,000 Cash Prize                 | 1 张   | 1-2 张     | `cash5k-cover.jpg`, `cash5k-1.jpg`                                |
| JM-008 | Cash        | ₱10,000 Cash Prize                | 1 张   | 1-2 张     | `cash10k-cover.jpg`, `cash10k-1.jpg`                              |

---

## 三、奖励素材清单（Lucky Draw 奖品视觉）

> 当前数据库模型里 Lucky Draw 奖品没有独立 `image` 字段。  
> 建议先按下表准备素材，前端可先用「奖品名称 + 固定映射」显示，后续再加字段升级。

| 活动                    | 奖品                     | 建议素材文件名                | 备注       |
| ----------------------- | ------------------------ | ----------------------------- | ---------- |
| Global Lucky Draw       | WELCOME50 Coupon         | `reward_coupon_welcome50.png` | 券面视觉   |
| Global Lucky Draw       | 100 Coins                | `reward_coin_100.png`         | 金币图标   |
| Global Lucky Draw       | ₱30 Wallet Bonus         | `reward_wallet_30.png`        | 余额奖励图 |
| Global Lucky Draw       | Thanks for Participating | `reward_thanks.png`           | 兜底图     |
| iPhone Bonus Lucky Draw | BIG200 Coupon            | `reward_coupon_big200.png`    | 券面视觉   |
| iPhone Bonus Lucky Draw | 500 Coins                | `reward_coin_500.png`         | 金币图标   |
| iPhone Bonus Lucky Draw | ₱100 Wallet Bonus        | `reward_wallet_100.png`       | 余额奖励图 |
| iPhone Bonus Lucky Draw | Better Luck Next Time    | `reward_better_luck.png`      | 兜底图     |

---

## 四、推荐目录结构（上传侧）

```text
assets/
  products/
    JM-001/
      cover.jpg
      detail-1.jpg
      detail-2.jpg
    JM-002/
      cover.jpg
      detail-1.jpg
      detail-2.jpg
    ...
  rewards/
    reward_coupon_welcome50.png
    reward_coupon_big200.png
    reward_coin_100.png
    reward_coin_500.png
    reward_wallet_30.png
    reward_wallet_100.png
    reward_thanks.png
    reward_better_luck.png
```

---

## 五、最少人工配置流程（建议）

1. 按上面清单把图片上传到 CDN（保持文件名一致）。
2. 批量替换 seed 文件中的 URL（`seed-treasures.ts` + 未来 reward 映射文件）。
3. 运行 seed，一次注入分类/商品/优惠券/秒杀/抽奖/支付渠道/地址等基础数据。
4. 后台只做少量微调（排序、上下架），不再手工逐条新建。
