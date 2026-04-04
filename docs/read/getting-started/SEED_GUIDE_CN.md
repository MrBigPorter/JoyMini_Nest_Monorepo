# JoyMinis — Demo Data Seed 指南

> **运行命令**: `yarn workspace @lucky/api seed`  
> **幂等**: ✅ 重复运行安全，已存在的数据不会重复创建

---

## 文件结构

```
apps/api/scripts/seed/
├── index.ts                      ← 入口，按顺序调用所有子模块
├── system-config-exchange-rate.ts ← SystemConfig (汇率等)
├── product-category-list.ts      ← 产品分类 × 6
├── seed-treasures.ts             ← 抽奖产品 × 8 + 产品-分类关联
├── seed-sections.ts              ← 活动专区 × 2 + 专区商品关联
├── seed-banners.ts               ← Banner × 3
├── seed-ads.ts                   ← Advertisement × 3
├── seed-payment-channels.ts      ← PaymentChannel × 5
├── seed-flash-sale.ts            ← 秒杀场次 × 1 + 秒杀商品 × 3
├── seed-coupons.ts               ← 优惠券模板 × 4
├── seed-lucky-draw.ts            ← Lucky Draw 活动 × 2 + 奖品 × 8
├── seed-address-lite.ts          ← Province/City/Barangay 最小可用数据
├── seed-kyc-id-types.ts          ← KYC 证件类型 × 11
├── seed-wallet.ts                ← 测试用户 + 钱包（本地开发用）
├── seed-robots-lite.ts           ← 机器人用户 × 30
└── seed-groups.ts                ← 拼团演示数据 × 6（依赖产品 + 测试用户）
└── seed-login-logs.ts            ← 登录日志演示数据
```

**执行顺序**（有依赖关系）：

```
SystemConfig → ProductCategory → Address → KycIdType
            → Treasure + TreasureCategory
            → ActSection + ActSectionItem
            → Banner → Advertisement
            → PaymentChannel
            → FlashSaleSession + FlashSaleProduct
            → Coupon
            → LuckyDrawActivity + LuckyDrawPrize
            → Test User + UserWallet
            → Robot Users
            → TreasureGroup + TreasureGroupMember
            → UserLoginLog
```

---

## 一、产品分类 `ProductCategory`

| id   | name        | nameEn      | sortOrder |
| ---- | ----------- | ----------- | --------- |
| 自增 | Electronics | Electronics | 1         |
| 自增 | Home        | Home        | 2         |
| 自增 | Fashion     | Fashion     | 3         |
| 自增 | Sports      | Sports      | 4         |
| 自增 | Beauty      | Beauty      | 5         |
| 自增 | Cash        | Cash        | 6         |

**幂等**: 按 `name` 查重

---

## 二、抽奖产品 `Treasure` × 8

> **字段说明**
>
> - `unitAmount` — 每份价格（PHP），用户购买的最小单位
> - `seqShelvesQuantity` — 总份数（总票数），售罄后触发开奖
> - `minBuyQuantity` — 触发开奖所需最低售出份数（售罄模式下 = 总份数）
> - `maxPerBuyQuantity` — 单人最大购买份数（防止一人扫光）
> - `lotteryMode` — `1`=售罄即开奖 / `2`=定时开奖
> - `virtual` — `1`=虚拟奖品(现金) / `2`=实物
> - `shippingType` — `1`=需发货 / `2`=无需发货（现金奖）
> - `fakeSalesCount` — 虚拟已售数（前端「已售 X 份」热度展示）
> - `groupSize` — 成团所需人数
> - `groupTimeLimit` — 成团时效（秒），超时未满则机器人补齐
> - `enableRobot` — 是否允许机器人自动补齐
> - `robotDelay` — 机器人介入前等待秒数（600s = 10min）

| seq        | 产品名称                          | 价格/份 | 总份数 | 总价值  | 拼团  | 类型     |
| ---------- | --------------------------------- | ------- | ------ | ------- | ----- | -------- |
| **JM-001** | Apple iPhone 16 Pro 256GB         | ₱250    | 300    | ₱75,000 | 5人团 | 实物     |
| **JM-002** | Samsung Galaxy S25 Ultra 512GB    | ₱200    | 300    | ₱60,000 | 5人团 | 实物     |
| **JM-003** | Sony PlayStation 5 Slim + 3 Games | ₱150    | 200    | ₱30,000 | 3人团 | 实物     |
| **JM-004** | Dyson V15 Detect Absolute Vacuum  | ₱100    | 150    | ₱15,000 | 3人团 | 实物     |
| **JM-005** | Nike Air Jordan 4 Retro (US10)    | ₱50     | 100    | ₱5,000  | 5人团 | 实物     |
| **JM-006** | Dyson Supersonic HD15 Hair Dryer  | ₱80     | 125    | ₱10,000 | 3人团 | 实物     |
| **JM-007** | ₱5,000 Cash Prize 💰              | ₱100    | 60     | ₱6,000  | 5人团 | **虚拟** |
| **JM-008** | ₱10,000 Cash Prize 💎             | ₱200    | 60     | ₱12,000 | 5人团 | **虚拟** |

> **平台利润逻辑**（现金奖为例）：  
> JM-007: 收₱100×60=₱6,000，派₱5,000，平台净赚₱1,000  
> JM-008: 收₱200×60=₱12,000，派₱10,000，平台净赚₱2,000

**幂等**: 按 `treasureSeq` (`@unique`) 查重

---

## 三、产品-分类关联 `TreasureCategory`

| treasureSeq     | category    |
| --------------- | ----------- |
| JM-001 ~ JM-003 | Electronics |
| JM-004          | Home        |
| JM-005          | Fashion     |
| JM-006          | Beauty      |
| JM-007 ~ JM-008 | Cash        |

**幂等**: 按 `(treasureId, categoryId)` 查重

---

## 四、活动专区 `ActSection` + `ActSectionItem`

| key            | title           | 关联产品                       | sortOrder |
| -------------- | --------------- | ------------------------------ | --------- |
| `HOT_PICKS`    | 🔥 Hot Picks    | JM-001, JM-002, JM-007, JM-008 | 1         |
| `NEW_ARRIVALS` | ✨ New Arrivals | JM-005, JM-006, JM-003, JM-004 | 2         |

> `imgStyleType=0` = 标准卡片样式；`limit=8` = 每区最多展示8个

**幂等**: ActSection 按 `key` (`@unique`) upsert；ActSectionItem 按 `(sectionId, treasureId)` 查重

---

## 五、Banner × 3

| 位置       | title               | bannerCate | position | showType | 跳转                      |
| ---------- | ------------------- | ---------- | -------- | -------- | ------------------------- |
| 首页顶部   | ⚡ Flash Sale       | 1 (首页)   | 0 (顶部) | 2 (轮播) | `/pages/flash-sale/index` |
| 首页中部   | 👥 Group Buy        | 1 (首页)   | 1 (中部) | 1 (单图) | `/pages/group-buy/index`  |
| 活动页顶部 | 🎉 Grand Lucky Draw | 2 (活动页) | 0 (顶部) | 1 (单图) | 外链                      |

> 首页顶部轮播的 `bannerArray` 包含 3 帧，分别指向 JM-001、JM-003、JM-008

**幂等**: 按 `createdBy='seed'` 计数，已有数据则整组跳过

---

## 六、广告位 `Advertisement` × 3

| title                               | adPosition | 有效期 |
| ----------------------------------- | ---------- | ------ |
| JoyMinis — Win Big Every Day!       | 1 (首页顶) | 90天   |
| Flash Sale Tonight — Don't Miss Out | 3 (分类页) | 7天    |
| Invite Friends, Earn ₱50 Bonus      | 4 (详情页) | 90天   |

**幂等**: 按 `title` 查重

---

## 七、秒杀 `FlashSaleSession` + `FlashSaleProduct`

**场次**: `⚡ Tonight's Flash Sale`

- `startTime`: 运行 seed 后 **2小时**开始
- `endTime`: 运行 seed 后 **6小时**结束（持续4小时）

**秒杀商品**（`flashPrice` < `unitAmount`）:

| seq    | 产品          | 原价/份 | 秒杀价/份 | 折扣 | 秒杀库存 |
| ------ | ------------- | ------- | --------- | ---- | -------- |
| JM-001 | iPhone 16 Pro | ₱250    | **₱150**  | -40% | 60份     |
| JM-003 | PlayStation 5 | ₱150    | **₱80**   | -47% | 100份    |
| JM-007 | Cash ₱5,000   | ₱100    | **₱60**   | -40% | 30份     |

> `flashStock` 与主产品 `seqShelvesQuantity` **相互独立**，秒杀库存售完后回归原价

**幂等**: 按 `title` 查找 session；按 `(sessionId, treasureId)` 查找 product

---

## 八、优惠券模板 `Coupon` × 4

| code        | 名称         | 类型   | 规则                  | 发放     | 有效期   | 数量   |
| ----------- | ------------ | ------ | --------------------- | -------- | -------- | ------ |
| `WELCOME50` | 新用户欢迎券 | 满减   | 满₱200减₱50           | 系统     | 领后7天  | 500张  |
| `VIP90`     | VIP九折券    | 折扣   | 满₱500打9折，上限₱100 | 系统     | 固定30天 | 200张  |
| `FREE30`    | 无门槛现金券 | 无门槛 | 直减₱30               | 系统     | 领后7天  | 1000张 |
| `BIG200`    | 大额满减券   | 满减   | 满₱1,000减₱200        | 用户领取 | 固定30天 | 100张  |

> **couponType**: `1`=满减 / `2`=折扣(百分比) / `3`=无门槛现金  
> **issueType**: `1`=系统主动发放 / `2`=用户领取页自行领取  
> **validType**: `1`=固定日期范围 / `2`=领券后N天有效

**幂等**: 按 `couponCode` (`@unique`) 查重

---

## 九、支付渠道 `PaymentChannel` × 5

| code                | type | name           | 金额限制        |
| ------------------- | ---- | -------------- | --------------- |
| `PH_GCASH`          | 充值 | GCash          | ₱50 ~ ₱50,000   |
| `PH_PAYMAYA`        | 充值 | PayMaya        | ₱50 ~ ₱50,000   |
| `PH_BDO`            | 充值 | BDO Online     | ₱100 ~ ₱80,000  |
| `PH_BANK_WITHDRAW`  | 提现 | Bank Transfer  | ₱200 ~ ₱100,000 |
| `PH_GCASH_WITHDRAW` | 提现 | GCash Withdraw | ₱100 ~ ₱50,000  |

**幂等**: 按 `code` 查重，存在则更新配置。

---

## 十、地址最小可用集 `Province` + `City` + `Barangay`

- 省份：Metro Manila、Cebu
- 城市：Makati / Quezon City / Taguig / Cebu City / Mandaue
- 每个城市内置 4 个高频 Barangay

**幂等**:

- Province 按 `provinceName` upsert
- City 按 `(provinceId, cityName)` 查重
- Barangay 按 `(cityId, barangayName)` 查重

---

## 十一、KYC 证件类型 `KycIdType` × 11

覆盖 GLOBAL / PH / CN / VN 常见证件，含 Passport、PhilSys、Driver License、UMID 等。

**幂等**: 按 `id` upsert，存在则更新 label/status/sortOrder。

---

## 十二、测试用户 + 钱包（本地开发）

| 字段        | 值              |
| ----------- | --------------- |
| phone       | `+639171234567` |
| nickname    | `🧪 Test User`  |
| inviteCode  | `TESTUSER`      |
| realBalance | ₱5,000          |
| coinBalance | 1,000 coins     |

**幂等**: 按 `phone` 查重；wallet 按 `userId` upsert（每次重置余额）

---

## 十三、福利抽奖 `LuckyDrawActivity` + `LuckyDrawPrize`

当前 seed 会创建 2 个活动：

| title                        | 范围                          | 状态 |
| ---------------------------- | ----------------------------- | ---- |
| `🎉 Global Lucky Draw`       | 全平台（`treasureId = null`） | 启用 |
| `📱 iPhone Bonus Lucky Draw` | 指定 `JM-001`                 | 启用 |

奖品配置（每个活动 4 个奖品，概率和 = 100）：

- `Global Lucky Draw`: `WELCOME50` 券 20% / 100金币 30% / ₱30余额 10% / 谢谢参与 40%
- `iPhone Bonus`: `BIG200` 券 5% / 500金币 15% / ₱100余额 10% / 谢谢参与 70%

> 说明：`LuckyDrawTicket` 与 `LuckyDrawResult` 不做 seed，属于运行期数据（下单/抽奖行为触发）。

**幂等**:

- 活动按 `(title, treasureId)` 查重
- 奖品按 `(activityId, sortOrder, prizeType)` 查重并更新

---

## 十四、机器人用户 `User.isRobot=true` × 30

用于拼团补位、在线人数演示、登录日志演示。

**幂等**: 按固定手机号段 `+6399900xxxx` 查重，缺失时补齐。

---

## 十五、拼团演示数据 `TreasureGroup` + `TreasureGroupMember`

**依赖**: 需先执行 [5] Treasure、[12] TestUser、[14] Robot Users。

| seq    | 产品             | 成团人数 | 演示成员数 | 机器人数 | 状态   |
| ------ | ---------------- | -------- | ---------- | -------- | ------ |
| JM-001 | iPhone 16 Pro    | 5人团    | 3人        | 2        | 进行中 |
| JM-002 | Galaxy S25 Ultra | 5人团    | 2人        | 1        | 进行中 |
| JM-003 | PS5 Slim         | 3人团    | 2人        | 1        | 进行中 |
| JM-004 | Dyson V15        | 3人团    | 1人        | 0        | 进行中 |
| JM-005 | Air Jordan 4     | 5人团    | 1人        | 0        | 进行中 |
| JM-006 | Dyson Supersonic | 3人团    | 1人        | 0        | 进行中 |

- **团长**: 测试账号 `+639171234567`（memberType=0 真实用户，isOwner=1）
- **机器人成员**: 从 `users.is_robot=true` 中取前 N 条（memberType=1）
- **expireAt**: seed 执行时间 + `treasure.groupTimeLimit` 秒（默认 24h 后过期）

> **TreasureGroup 字段枚举**:  
> `groupStatus`: 1=进行中 2=拼团成功 3=失败/过期  
> `memberType`: 0=真实用户 1=机器人  
> `isOwner`: 0=普通成员 1=团长

**幂等**: `findFirst({ where: { treasureId, creatorId, groupStatus: 1 } })` 存在则跳过。

---

## 十六、登录日志演示 `UserLoginLog`

会自动为测试用户与部分机器人补充登录日志样本（成功/失败混合），用于后台登录日志页直接可见数据。

**幂等**: 按 `userId + loginDevice='Seed Demo Device'` 查重。

---

## 如何自定义

### 修改产品

编辑 `seed-treasures.ts` 中的 `TREASURES` 数组：

```ts
{
  treasureSeq:        'JM-009',        // ← 必须唯一，作为幂等 key
  treasureName:       '新产品名称',
  unitAmount:         100,             // 每份 PHP
  seqShelvesQuantity: 200,             // 总份数
  lotteryMode:        1,               // 1=售罄开奖
  virtual:            2,               // 2=实物
  ...G5,                               // 5人拼团
  category:           'Electronics',  // 分类名称（必须已在 ProductCategory 中）
}
```

### 修改优惠券

编辑 `seed-coupons.ts` 中的 `COUPONS` 数组，每个 `couponCode` 必须全局唯一。

### 添加新秒杀场次

在 `seed-flash-sale.ts` 中修改 `SESSION_TITLE` 和 `FLASH_PRODUCTS`，或直接增加一个新的 session 对象。

### 更改 Banner / 广告

- Banner: 修改 `seed-banners.ts` 后，需先删除数据库中 `createdBy='seed'` 的记录，再重新运行
- 广告: 直接修改 `seed-ads.ts` 中的 `ADS` 数组（按 title 查重）

---

## 常见问题

**Q: 运行报错 `prisma is not defined`**  
A: 确保在容器/本地已运行 `prisma generate`：

```bash
node apps/api/node_modules/.bin/prisma generate --schema apps/api/prisma/schema.prisma
```

**Q: 产品已存在但想更新数据**  
A: 在数据库执行 `DELETE FROM treasures WHERE treasure_seq LIKE 'JM-%';`，然后重新运行 seed。

**Q: Banner 重复运行后没有更新**  
A: 清除标记数据：`DELETE FROM banners WHERE created_by = 'seed';`，然后重新运行。

**Q: 秒杀时间已过期，如何重置**  
A: 删除对应 session：`DELETE FROM flash_sale_sessions WHERE title = '⚡ Tonight''s Flash Sale';`，然后重新运行。

**Q: 拼团数据想重置**  
A: 清除拼团数据（成员会级联删除）：

```sql
DELETE FROM treasure_groups
WHERE creator_id = (SELECT id FROM users WHERE phone = '+639171234567');
```

然后重新运行 seed。
