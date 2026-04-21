# 抽奖电商系统数据库设计文档

## 目录

- [概述](#概述)
- [数据库表设计](#数据库表设计)
  - [用户体系 (5张表)](#用户体系)
  - [产品抽奖体系 (5张表)](#产品抽奖体系)

---

## 概述

本文档描述了基于 Flutter App 的抽奖电商系统的完整数据库设计。系统包含用户管理、产品抽奖、订单交易、优惠券营销、客服系统等核心功能模块。

**技术栈：**

- 数据库：MySQL 8.0+
- 主键策略：雪花ID (BIGINT)
- 时间存储：毫秒级时间戳 (BIGINT) 或 TIMESTAMP
- 金额存储：DECIMAL(10,2)
- 币种：PHP (菲律宾比索)

**数据特点：**

- 所有API响应遵循统一格式：`{code, message, tid, data}`
- 使用雪花算法生成分布式唯一ID
- 图片资源存储在 AWS S3
- 支持多语言（英语、塔加洛语）

---

## 数据库表设计

### 用户体系

#### 1. users - 用户表

**表说明：** 存储用户基本信息，是整个系统的核心用户表。 完成

```sql
CREATE TABLE users (
    id BIGINT PRIMARY KEY COMMENT '用户ID（雪花ID）',
    nickname VARCHAR(100) COMMENT '昵称',
    avatar VARCHAR(255) COMMENT '头像URL',
    phone VARCHAR(20) COMMENT '手机号',
    phone_md5 VARCHAR(32) COMMENT '手机号MD5',
    invite_code VARCHAR(20) UNIQUE COMMENT '邀请码',
    vip_level TINYINT DEFAULT 0 COMMENT 'VIP等级',
    kyc_status TINYINT DEFAULT 0 COMMENT 'KYC状态: 0-未认证 1-审核中 2-审核失败 3-待补充 4-已认证',
    delivery_address_id BIGINT COMMENT '默认收货地址ID',
    self_exclusion_expire_at BIGINT COMMENT '自我排除过期时间戳',
    last_login_at BIGINT COMMENT '最后登录时间戳',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    INDEX idx_phone(phone),
    INDEX idx_invite_code(invite_code),
    INDEX idx_kyc_status(kyc_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';
```

**字段说明：**

| 字段名                   | 类型         | 说明                   | 示例值                                  |
| ------------------------ | ------------ | ---------------------- | --------------------------------------- |
| id                       | BIGINT       | 用户唯一ID（雪花算法） | 584112257881866250                      |
| nickname                 | VARCHAR(100) | 用户昵称               | pl_584112257881866250                   |
| avatar                   | VARCHAR(255) | 头像URL                | https://xxx.s3.amazonaws.com/avatar.png |
| phone                    | VARCHAR(20)  | 手机号（包含国家码）   | 9043443444                              |
| phone_md5                | VARCHAR(32)  | 手机号MD5（隐私保护）  | dd98cba23faa4c515ceb2d6c30c841e3        |
| invite_code              | VARCHAR(20)  | 邀请码（唯一）         | 635995310                               |
| vip_level                | TINYINT      | VIP等级                | 0-普通 1-VIP1 2-VIP2...                 |
| kyc_status               | TINYINT      | KYC认证状态            | 0-未认证 4-已认证                       |
| delivery_address_id      | BIGINT       | 默认收货地址ID         | 201                                     |
| self_exclusion_expire_at | BIGINT       | 自我排除过期时间       | 1757687636519                           |
| last_login_at            | BIGINT       | 最后登录时间戳         | 1757687636519                           |

---

#### 2. user_addresses - 用户地址表

**表说明：** 存储用户的收货地址信息，支持多地址管理。

```sql
CREATE TABLE user_addresses (
    address_id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '地址ID',
    user_id BIGINT NOT NULL COMMENT '用户ID',
    first_name VARCHAR(50) NOT NULL COMMENT '名',
    middle_name VARCHAR(50) COMMENT '中间名',
    last_name VARCHAR(50) NOT NULL COMMENT '姓',
    phone VARCHAR(20) NOT NULL COMMENT '联系电话',
    province VARCHAR(50) NOT NULL COMMENT '省份',
    city VARCHAR(50) NOT NULL COMMENT '城市',
    full_address TEXT NOT NULL COMMENT '详细地址',
    postal_code VARCHAR(10) COMMENT '邮政编码',
    is_default TINYINT DEFAULT 0 COMMENT '是否默认地址: 0-否 1-是',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    INDEX idx_user_id(user_id),
    INDEX idx_is_default(user_id, is_default),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户地址表';
```

**字段说明：**

| 字段名       | 类型        | 说明           | 示例值                      |
| ------------ | ----------- | -------------- | --------------------------- |
| address_id   | BIGINT      | 地址唯一ID     | 201                         |
| user_id      | BIGINT      | 用户ID（外键） | 584112257881866250          |
| first_name   | VARCHAR(50) | 名             | Juan                        |
| middle_name  | VARCHAR(50) | 中间名（可选） | D.                          |
| last_name    | VARCHAR(50) | 姓             | Cruz                        |
| phone        | VARCHAR(20) | 联系电话       | +63 912 345 6789            |
| province     | VARCHAR(50) | 省份           | Metro Manila                |
| city         | VARCHAR(50) | 城市           | Quezon City                 |
| full_address | TEXT        | 详细地址       | Blk 12 Lot 5, Camella Homes |
| postal_code  | VARCHAR(10) | 邮政编码       | 1121                        |
| is_default   | TINYINT     | 是否默认地址   | 0-否 1-是                   |

**业务规则：**

- 每个用户可以有多个地址
- 只能有一个默认地址
- 删除用户时级联删除所有地址

---

#### 3. user_wallets - 用户钱包余额表

**表说明：** 存储用户的现金和金币余额，是资金管理的核心表。

```sql
CREATE TABLE user_wallets (
    id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '钱包ID',
    user_id BIGINT UNIQUE NOT NULL COMMENT '用户ID（唯一）',
    real_balance DECIMAL(10,2) DEFAULT 0.00 COMMENT '现金余额（PHP）',
    coin_balance DECIMAL(10,2) DEFAULT 0.00 COMMENT '金币余额',
    frozen_balance DECIMAL(10,2) DEFAULT 0.00 COMMENT '冻结金额',
    total_recharge DECIMAL(10,2) DEFAULT 0.00 COMMENT '累计充值',
    total_withdraw DECIMAL(10,2) DEFAULT 0.00 COMMENT '累计提现',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    INDEX idx_user_id(user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户钱包余额表';
```

**字段说明：**

| 字段名         | 类型          | 说明           | 示例值             |
| -------------- | ------------- | -------------- | ------------------ |
| id             | BIGINT        | 钱包ID         | 1                  |
| user_id        | BIGINT        | 用户ID（唯一） | 584112257881866250 |
| real_balance   | DECIMAL(10,2) | 现金余额       | 2000.00            |
| coin_balance   | DECIMAL(10,2) | 金币余额       | 5.00               |
| frozen_balance | DECIMAL(10,2) | 冻结金额       | 100.00             |
| total_recharge | DECIMAL(10,2) | 累计充值       | 5000.00            |
| total_withdraw | DECIMAL(10,2) | 累计提现       | 500.00             |

**业务规则：**

- 每个用户只有一个钱包（1对1关系）
- 金币与现金兑换比例：10 Lucky Coins = ₱1
- 余额变动需记录到 wallet_transactions 表
- 支持余额冻结（订单未完成时）

---

#### 4. kyc_records - KYC认证表

**表说明：** 存储用户的KYC（身份认证）记录，包括身份证、人脸识别等信息。

```sql
CREATE TABLE kyc_records (
    id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '认证记录ID',
    user_id BIGINT NOT NULL COMMENT '用户ID',
    kyc_status TINYINT DEFAULT 0 COMMENT '认证状态: 0-未提交 1-审核中 2-审核失败 3-待补充 4-已通过',
    id_card_front VARCHAR(255) COMMENT '身份证正面URL',
    id_card_back VARCHAR(255) COMMENT '身份证背面URL',
    face_image VARCHAR(255) COMMENT '人脸照片URL',
    liveness_token TEXT COMMENT '活体检测token',
    ocr_result JSON COMMENT 'OCR识别结果（JSON格式）',
    audit_result TEXT COMMENT '审核结果说明',
    rejected_reason VARCHAR(255) COMMENT '拒绝原因',
    submitted_at BIGINT COMMENT '提交时间戳',
    audited_at BIGINT COMMENT '审核时间戳',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    INDEX idx_user_status(user_id, kyc_status),
    INDEX idx_submitted_at(submitted_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='KYC认证表';
```

**字段说明：**

| 字段名          | 类型         | 说明          | 示例值                                    |
| --------------- | ------------ | ------------- | ----------------------------------------- |
| id              | BIGINT       | 认证记录ID    | 1                                         |
| user_id         | BIGINT       | 用户ID        | 584112257881866250                        |
| kyc_status      | TINYINT      | 认证状态      | 4-已通过                                  |
| id_card_front   | VARCHAR(255) | 身份证正面    | https://xxx.s3.amazonaws.com/id_front.jpg |
| id_card_back    | VARCHAR(255) | 身份证背面    | https://xxx.s3.amazonaws.com/id_back.jpg  |
| face_image      | VARCHAR(255) | 人脸照片      | https://xxx.s3.amazonaws.com/face.jpg     |
| liveness_token  | TEXT         | 活体检测token | eyJhbGciOiJIUzI1NiIsInR5cCI6...           |
| ocr_result      | JSON         | OCR识别结果   | {"name":"Juan Cruz","id":"123456"}        |
| audit_result    | TEXT         | 审核结果      | 认证通过                                  |
| rejected_reason | VARCHAR(255) | 拒绝原因      | 照片模糊，请重新上传                      |
| submitted_at    | BIGINT       | 提交时间戳    | 1757687636519                             |
| audited_at      | BIGINT       | 审核时间戳    | 1757687636519                             |

**业务规则：**

- 用户可以有多次KYC提交记录
- 只有KYC通过（status=4）才能购买抽奖票
- OCR结果使用JSON存储，包含姓名、证件号等信息
- 支持H5活体检测和人脸识别

---

#### 5. user_invitations - 邀请好友关系表

**表说明：** 存储用户邀请关系，用于邀请奖励和推广统计。

```sql
CREATE TABLE user_invitations (
    id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '邀请记录ID',
    inviter_id BIGINT NOT NULL COMMENT '邀请人用户ID',
    invitee_id BIGINT NOT NULL COMMENT '被邀请人用户ID',
    invitee_nickname VARCHAR(100) COMMENT '被邀请人昵称',
    invitee_avatar VARCHAR(255) COMMENT '被邀请人头像',
    status TINYINT DEFAULT 1 COMMENT '状态: 1-已注册 2-已完成首充',
    invitee_first_receive_coin DECIMAL(10,2) DEFAULT 0 COMMENT '被邀请人首次获得金币',
    coupon_amount DECIMAL(10,2) DEFAULT 0 COMMENT '邀请人获得优惠券金额',
    invitee_registered_at BIGINT COMMENT '被邀请人注册时间戳',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    UNIQUE KEY uk_inviter_invitee(inviter_id, invitee_id),
    INDEX idx_inviter(inviter_id),
    INDEX idx_invitee(invitee_id),
    INDEX idx_status(status),
    FOREIGN KEY (inviter_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (invitee_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='邀请好友关系表';
```

**字段说明：**

| 字段名                     | 类型          | 说明             | 示例值                                  |
| -------------------------- | ------------- | ---------------- | --------------------------------------- |
| id                         | BIGINT        | 邀请记录ID       | 1                                       |
| inviter_id                 | BIGINT        | 邀请人ID         | 584112257881866250                      |
| invitee_id                 | BIGINT        | 被邀请人ID       | 584113257881866251                      |
| invitee_nickname           | VARCHAR(100)  | 被邀请人昵称     | Alice                                   |
| invitee_avatar             | VARCHAR(255)  | 被邀请人头像     | https://xxx.s3.amazonaws.com/avatar.png |
| status                     | TINYINT       | 状态             | 1-已注册 2-已完成首充                   |
| invitee_first_receive_coin | DECIMAL(10,2) | 被邀请人获得金币 | 100.00                                  |
| coupon_amount              | DECIMAL(10,2) | 邀请人获得优惠券 | 50.00                                   |
| invitee_registered_at      | BIGINT        | 注册时间戳       | 1757823600000                           |

**业务规则：**

- 邀请关系是一对多的（一个用户可以邀请多个人）
- 被邀请人注册时自动创建邀请记录
- 被邀请人完成首充后，邀请人获得奖励
- 支持邀请码追踪和统计

---

## 表关系图

```
users (用户表)
├─ user_wallets (1对1: 钱包余额)
├─ user_addresses (1对多: 收货地址)
├─ kyc_records (1对多: KYC认证记录)
└─ user_invitations (1对多: 邀请关系)
    ├─ inviter_id → users.id (邀请人)
    └─ invitee_id → users.id (被邀请人)
```

---

## 索引策略

### 常用查询索引

1. **用户登录：** `idx_phone` (users表)
2. **邀请查询：** `idx_invite_code` (users表)
3. **KYC查询：** `idx_user_status` (kyc_records表)
4. **默认地址：** `idx_is_default` (user_addresses表)
5. **邀请统计：** `idx_inviter`, `idx_status` (user_invitations表)

### 外键约束

- 所有关联表都使用 `ON DELETE CASCADE`，删除用户时自动清理关联数据
- 钱包表与用户表是1对1强关联

---

## 数据安全

1. **敏感信息加密：**
   - 手机号使用MD5存储（phone_md5）
   - 密码不存储明文（使用JWT token认证）

2. **权限控制：**
   - KYC审核后才能进行交易
   - 钱包余额变动需要事务保护

3. **数据备份：**
   - 建议每天备份用户核心数据
   - 交易记录需永久保存

---

### 产品抽奖体系

#### 6. treasures - 抽奖产品表

**表说明：** 存储所有抽奖产品的详细信息，是产品管理的核心表。

```sql
CREATE TABLE treasures (
    treasure_id BIGINT PRIMARY KEY COMMENT '产品ID（雪花ID）',
    treasure_seq VARCHAR(50) UNIQUE COMMENT '产品序列号',
    treasure_name VARCHAR(200) NOT NULL COMMENT '产品名称',
    product_name VARCHAR(200) COMMENT '实物产品名称',
    treasure_cover_img VARCHAR(255) COMMENT '封面图URL',
    main_image_list JSON COMMENT '主图列表（JSON数组）',

    -- 价格相关
    cost_amount DECIMAL(10,2) COMMENT '产品成本（PHP）',
    unit_amount DECIMAL(10,2) DEFAULT 1.00 COMMENT '单价/每份（PHP）',
    cash_amount DECIMAL(10,2) COMMENT '现金奖励金额',

    -- 库存相关
    seq_shelves_quantity INT COMMENT '总库存/总份数',
    seq_buy_quantity INT DEFAULT 0 COMMENT '已购买数量',
    min_buy_quantity INT COMMENT '最小购买量（开奖所需份数）',
    max_per_buy_quantity INT COMMENT '单人最大购买量',
    buy_quantity_rate DECIMAL(5,2) COMMENT '购买率百分比',

    -- 抽奖规则
    lottery_mode TINYINT COMMENT '抽奖模式: 1-售罄模式 2-定时模式',
    lottery_time BIGINT COMMENT '开奖时间戳',
    lottery_delay_time BIGINT COMMENT '延迟开奖时间',
    lottery_delay_state TINYINT DEFAULT 0 COMMENT '是否延迟: 0-否 1-是',

    -- 显示与样式
    img_style_type TINYINT DEFAULT 0 COMMENT '图片样式类型',
    virtual TINYINT DEFAULT 2 COMMENT '是否虚拟产品: 1-虚拟 2-实物',

    -- 组团与分享
    group_max_num INT DEFAULT 9999 COMMENT '组团最大人数',

    -- 金币与优惠
    max_unit_coins DECIMAL(10,4) COMMENT '单份最大使用金币数',
    max_unit_amount DECIMAL(10,2) COMMENT '最大折扣金额',

    -- 其他
    charity_amount DECIMAL(10,2) COMMENT '慈善金额',
    cash_state TINYINT COMMENT '现金状态',
    rule_content TEXT COMMENT '规则说明（HTML）',
    `desc` TEXT COMMENT '产品描述（HTML）',

    state TINYINT DEFAULT 1 COMMENT '状态: 0-下架 1-上架',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    INDEX idx_lottery_mode(lottery_mode),
    INDEX idx_lottery_time(lottery_time),
    INDEX idx_state(state),
    INDEX idx_buy_rate(buy_quantity_rate)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='抽奖产品表';
```

**字段说明：**

| 字段名               | 类型          | 说明         | 示例值                                 |
| -------------------- | ------------- | ------------ | -------------------------------------- |
| treasure_id          | BIGINT        | 产品唯一ID   | 10                                     |
| treasure_seq         | VARCHAR(50)   | 产品序列号   | TRE20250101001                         |
| treasure_name        | VARCHAR(200)  | 产品名称     | Win ₱3,200 or Realme T300              |
| product_name         | VARCHAR(200)  | 实物产品名   | Realme T300                            |
| treasure_cover_img   | VARCHAR(255)  | 封面图       | https://xxx.s3.amazonaws.com/cover.jpg |
| main_image_list      | JSON          | 主图数组     | ["url1", "url2"]                       |
| cost_amount          | DECIMAL(10,2) | 成本         | 3200.00                                |
| unit_amount          | DECIMAL(10,2) | 单价         | 1.00                                   |
| cash_amount          | DECIMAL(10,2) | 现金奖励     | 3200.00                                |
| seq_shelves_quantity | INT           | 总份数       | 4600                                   |
| seq_buy_quantity     | INT           | 已售份数     | 3668                                   |
| min_buy_quantity     | INT           | 开奖所需份数 | 4600                                   |
| buy_quantity_rate    | DECIMAL(5,2)  | 购买率%      | 79.74                                  |
| lottery_mode         | TINYINT       | 抽奖模式     | 1-售罄 2-定时                          |
| lottery_time         | BIGINT        | 开奖时间戳   | 1759734000000                          |
| virtual              | TINYINT       | 是否虚拟     | 1-虚拟 2-实物                          |
| group_max_num        | INT           | 最大组团人数 | 9999                                   |

**业务规则：**

- 售罄模式：达到 min_buy_quantity 时自动开奖
- 定时模式：到达 lottery_time 时开奖
- 购买率 = (seq_buy_quantity / seq_shelves_quantity) \* 100
- 虚拟产品直接发放兑换码，实物产品需要物流配送

---

#### 7. product_categories - 产品分类表

**表说明：** 存储产品分类信息，用于产品分组展示。

```sql
CREATE TABLE product_categories (
    products_category_id INT PRIMARY KEY AUTO_INCREMENT COMMENT '分类ID',
    name VARCHAR(100) NOT NULL COMMENT '分类名称',
    name_en VARCHAR(100) COMMENT '分类英文名',
    icon VARCHAR(255) COMMENT '分类图标URL',
    sort_order INT DEFAULT 0 COMMENT '排序值（越小越靠前）',
    state TINYINT DEFAULT 1 COMMENT '状态: 0-禁用 1-启用',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    INDEX idx_state(state),
    INDEX idx_sort(sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='产品分类表';
```

**字段说明：**

| 字段名               | 类型         | 说明     | 示例值                                |
| -------------------- | ------------ | -------- | ------------------------------------- |
| products_category_id | INT          | 分类ID   | 18                                    |
| name                 | VARCHAR(100) | 分类名称 | Hot                                   |
| name_en              | VARCHAR(100) | 英文名   | Hot Items                             |
| icon                 | VARCHAR(255) | 分类图标 | https://xxx.s3.amazonaws.com/icon.png |
| sort_order           | INT          | 排序     | 1                                     |
| state                | TINYINT      | 状态     | 0-禁用 1-启用                         |

**预设分类：**

- Hot (热门)
- Tech (数码科技)
- Home (家居用品)
- Cash (现金奖励)
- Travel (旅游度假)

---

#### 8. treasure_categories - 产品分类关联表

**表说明：** 产品与分类的多对多关联表，一个产品可以属于多个分类。

```sql
CREATE TABLE treasure_categories (
    id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '关联ID',
    treasure_id BIGINT NOT NULL COMMENT '产品ID',
    category_id INT NOT NULL COMMENT '分类ID',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    UNIQUE KEY uk_treasure_category(treasure_id, category_id),
    INDEX idx_treasure(treasure_id),
    INDEX idx_category(category_id),
    FOREIGN KEY (treasure_id) REFERENCES treasures(treasure_id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES product_categories(products_category_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='产品分类关联表';
```

**字段说明：**

| 字段名      | 类型   | 说明   | 示例值 |
| ----------- | ------ | ------ | ------ |
| id          | BIGINT | 关联ID | 1      |
| treasure_id | BIGINT | 产品ID | 10     |
| category_id | INT    | 分类ID | 18     |

**业务规则：**

- 一个产品可以属于多个分类（多对多关系）
- 删除产品或分类时，自动删除关联记录
- 前端可按分类筛选产品列表

---

#### 9. treasure_groups - 组团表

**表说明：** 存储用户创建的组团信息，支持多人组团参与抽奖。

```sql
CREATE TABLE treasure_groups (
    group_id BIGINT PRIMARY KEY COMMENT '组团ID（雪花ID）',
    treasure_id BIGINT NOT NULL COMMENT '产品ID',
    creator_id BIGINT NOT NULL COMMENT '创建人用户ID（团长）',
    group_name VARCHAR(100) COMMENT '组团名称',
    max_members INT DEFAULT 9999 COMMENT '最大成员数',
    current_members INT DEFAULT 1 COMMENT '当前成员数',
    lucky_winners_count INT DEFAULT 0 COMMENT '组内中奖次数',
    total_winning_times INT DEFAULT 0 COMMENT '总中奖次数',
    group_status TINYINT DEFAULT 1 COMMENT '状态: 1-进行中 2-已结束',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    INDEX idx_treasure(treasure_id),
    INDEX idx_creator(creator_id),
    INDEX idx_status(group_status),
    FOREIGN KEY (treasure_id) REFERENCES treasures(treasure_id) ON DELETE CASCADE,
    FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='组团表';
```

**字段说明：**

| 字段名              | 类型         | 说明         | 示例值             |
| ------------------- | ------------ | ------------ | ------------------ |
| group_id            | BIGINT       | 组团ID       | 584239367690649859 |
| treasure_id         | BIGINT       | 产品ID       | 10                 |
| creator_id          | BIGINT       | 团长用户ID   | 584238315222335747 |
| group_name          | VARCHAR(100) | 组团名称     | lizzie9's Team     |
| max_members         | INT          | 最大成员数   | 9999               |
| current_members     | INT          | 当前成员数   | 5                  |
| lucky_winners_count | INT          | 组内中奖次数 | 2                  |
| total_winning_times | INT          | 总中奖次数   | 10                 |
| group_status        | TINYINT      | 状态         | 1-进行中 2-已结束  |

**业务规则：**

- 每个产品可以有多个组团
- 团长购买产品时自动创建组团
- 其他用户可以加入已有组团
- 组员中奖时，团内其他成员可获得金币红包

---

#### 10. treasure_group_members - 组团成员表

**表说明：** 存储组团的成员信息及奖励分配。

```sql
CREATE TABLE treasure_group_members (
    id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '成员记录ID',
    group_id BIGINT NOT NULL COMMENT '组团ID',
    user_id BIGINT NOT NULL COMMENT '用户ID',
    order_id BIGINT COMMENT '订单ID',
    is_owner TINYINT DEFAULT 0 COMMENT '是否团长: 0-否 1-是',
    share_coin DECIMAL(10,2) DEFAULT 0 COMMENT '分享获得金币',
    share_amount DECIMAL(10,2) DEFAULT 0 COMMENT '分享获得金额',
    joined_at BIGINT COMMENT '加入时间戳',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    UNIQUE KEY uk_group_user(group_id, user_id),
    INDEX idx_group(group_id),
    INDEX idx_user(user_id),
    INDEX idx_order(order_id),
    FOREIGN KEY (group_id) REFERENCES treasure_groups(group_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='组团成员表';
```

**字段说明：**

| 字段名       | 类型          | 说明         | 示例值             |
| ------------ | ------------- | ------------ | ------------------ |
| id           | BIGINT        | 成员记录ID   | 1                  |
| group_id     | BIGINT        | 组团ID       | 584239367690649859 |
| user_id      | BIGINT        | 用户ID       | 584238315222335747 |
| order_id     | BIGINT        | 订单ID       | 1001               |
| is_owner     | TINYINT       | 是否团长     | 0-否 1-是          |
| share_coin   | DECIMAL(10,2) | 分享获得金币 | 50.00              |
| share_amount | DECIMAL(10,2) | 分享获得金额 | 5.00               |
| joined_at    | BIGINT        | 加入时间戳   | 1757763399759      |

**业务规则：**

- 一个用户在同一组团中只能有一条记录
- 团长的 is_owner = 1
- 组员中奖时，其他成员随机获得金币红包
- share_coin 和 share_amount 记录组员获得的奖励

---

## 表关系图（更新）

```
users (用户表)
├─ user_wallets (1对1: 钱包余额)
├─ user_addresses (1对多: 收货地址)
├─ kyc_records (1对多: KYC认证记录)
├─ user_invitations (1对多: 邀请关系)
└─ treasure_groups (1对多: 创建的组团)

treasures (产品表)
├─ treasure_categories (多对多: 产品分类)
│   └─ product_categories (分类表)
├─ treasure_groups (1对多: 组团)
│   └─ treasure_group_members (1对多: 组团成员)
└─ orders (1对多: 订单)
```

---

### 订单交易体系

#### 11. orders - 订单表

**表说明：** 存储用户购买抽奖票的订单信息，是交易系统的核心表。

```sql
CREATE TABLE orders (
    order_id BIGINT PRIMARY KEY COMMENT '订单ID（雪花ID）',
    order_no VARCHAR(50) UNIQUE NOT NULL COMMENT '订单编号',
    user_id BIGINT NOT NULL COMMENT '用户ID',
    treasure_id BIGINT NOT NULL COMMENT '产品ID',

    -- 订单金额
    original_amount DECIMAL(10,2) NOT NULL COMMENT '原始金额（PHP）',
    discount_amount DECIMAL(10,2) DEFAULT 0.00 COMMENT '折扣金额',
    coupon_amount DECIMAL(10,2) DEFAULT 0.00 COMMENT '优惠券抵扣',
    coin_amount DECIMAL(10,2) DEFAULT 0.00 COMMENT '金币抵扣',
    final_amount DECIMAL(10,2) NOT NULL COMMENT '实付金额',

    -- 购买信息
    buy_quantity INT NOT NULL COMMENT '购买份数',
    unit_price DECIMAL(10,2) NOT NULL COMMENT '单价',
    lucky_code_start VARCHAR(50) COMMENT '幸运码起始号',
    lucky_code_end VARCHAR(50) COMMENT '幸运码结束号',

    -- 订单状态
    order_status TINYINT DEFAULT 1 COMMENT '订单状态: 1-待支付 2-已支付 3-已取消 4-已退款',
    pay_status TINYINT DEFAULT 0 COMMENT '支付状态: 0-未支付 1-已支付',
    refund_status TINYINT DEFAULT 0 COMMENT '退款状态: 0-无退款 1-部分退款 2-全额退款',

    -- 组团信息
    group_id BIGINT COMMENT '组团ID',
    is_group_owner TINYINT DEFAULT 0 COMMENT '是否团长: 0-否 1-是',

    -- 优惠券
    coupon_id BIGINT COMMENT '使用的优惠券ID',
    coin_used DECIMAL(10,2) DEFAULT 0.00 COMMENT '使用的金币数量',

    -- 时间记录
    paid_at BIGINT COMMENT '支付时间戳',
    cancelled_at BIGINT COMMENT '取消时间戳',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX idx_user(user_id),
    INDEX idx_treasure(treasure_id),
    INDEX idx_order_no(order_no),
    INDEX idx_status(order_status, pay_status),
    INDEX idx_group(group_id),
    INDEX idx_created_at(created_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (treasure_id) REFERENCES treasures(treasure_id) ON DELETE RESTRICT,
    FOREIGN KEY (group_id) REFERENCES treasure_groups(group_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='订单表';
```

**字段说明：**

| 字段名           | 类型          | 说明       | 示例值             |
| ---------------- | ------------- | ---------- | ------------------ |
| order_id         | BIGINT        | 订单ID     | 584249482517872846 |
| order_no         | VARCHAR(50)   | 订单编号   | ORD20250121123456  |
| user_id          | BIGINT        | 用户ID     | 584112257881866250 |
| treasure_id      | BIGINT        | 产品ID     | 10                 |
| original_amount  | DECIMAL(10,2) | 原始金额   | 100.00             |
| discount_amount  | DECIMAL(10,2) | 折扣金额   | 10.00              |
| coupon_amount    | DECIMAL(10,2) | 优惠券抵扣 | 5.00               |
| coin_amount      | DECIMAL(10,2) | 金币抵扣   | 0.50               |
| final_amount     | DECIMAL(10,2) | 实付金额   | 84.50              |
| buy_quantity     | INT           | 购买份数   | 100                |
| unit_price       | DECIMAL(10,2) | 单价       | 1.00               |
| lucky_code_start | VARCHAR(50)   | 幸运码起始 | 000001             |
| lucky_code_end   | VARCHAR(50)   | 幸运码结束 | 000100             |
| order_status     | TINYINT       | 订单状态   | 2-已支付           |
| pay_status       | TINYINT       | 支付状态   | 1-已支付           |
| group_id         | BIGINT        | 组团ID     | 584239367690649859 |
| is_group_owner   | TINYINT       | 是否团长   | 0-否 1-是          |

**业务规则：**

- 订单编号格式：ORD + 年月日 + 序列号
- 实付金额 = 原始金额 - 折扣金额 - 优惠券抵扣 - 金币抵扣
- 金币抵扣比例：10 Lucky Coins = ₱1
- 幸运码是连续分配的，用于开奖
- 订单支付后不可取消，只能申请退款

---

#### 12. order_lucky_codes - 订单幸运码表

**表说明：** 存储订单的每个幸运码详情，用于开奖和中奖查询。

```sql
CREATE TABLE order_lucky_codes (
    id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '记录ID',
    order_id BIGINT NOT NULL COMMENT '订单ID',
    user_id BIGINT NOT NULL COMMENT '用户ID',
    treasure_id BIGINT NOT NULL COMMENT '产品ID',
    lucky_code VARCHAR(50) NOT NULL COMMENT '幸运码',
    is_winning TINYINT DEFAULT 0 COMMENT '是否中奖: 0-未中奖 1-中奖',
    winning_record_id BIGINT COMMENT '中奖记录ID',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    UNIQUE KEY uk_treasure_code(treasure_id, lucky_code),
    INDEX idx_order(order_id),
    INDEX idx_user(user_id),
    INDEX idx_treasure(treasure_id),
    INDEX idx_winning(is_winning),
    FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (treasure_id) REFERENCES treasures(treasure_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='订单幸运码表';
```

**字段说明：**

| 字段名            | 类型        | 说明       | 示例值             |
| ----------------- | ----------- | ---------- | ------------------ |
| id                | BIGINT      | 记录ID     | 1                  |
| order_id          | BIGINT      | 订单ID     | 584249482517872846 |
| user_id           | BIGINT      | 用户ID     | 584112257881866250 |
| treasure_id       | BIGINT      | 产品ID     | 10                 |
| lucky_code        | VARCHAR(50) | 幸运码     | 000001             |
| is_winning        | TINYINT     | 是否中奖   | 0-未中奖 1-中奖    |
| winning_record_id | BIGINT      | 中奖记录ID | 1001               |

**业务规则：**

- 每个订单根据购买份数生成对应数量的幸运码
- 幸运码在同一产品内唯一
- 开奖时随机抽取幸运码确定中奖者
- 中奖后更新 is_winning 和 winning_record_id

---

#### 13. payments - 支付记录表

**表说明：** 存储所有支付交易记录，包括充值、购买等。

```sql
CREATE TABLE payments (
    payment_id BIGINT PRIMARY KEY COMMENT '支付ID（雪花ID）',
    payment_no VARCHAR(50) UNIQUE NOT NULL COMMENT '支付流水号',
    user_id BIGINT NOT NULL COMMENT '用户ID',
    order_id BIGINT COMMENT '订单ID（可为空，充值时无订单）',

    -- 支付信息
    payment_type TINYINT NOT NULL COMMENT '支付类型: 1-充值 2-购买抽奖票 3-其他',
    payment_method TINYINT NOT NULL COMMENT '支付方式: 1-GCash 2-PayMaya 3-银行卡 4-钱包余额',
    payment_channel VARCHAR(50) COMMENT '支付渠道（第三方支付商）',

    -- 金额
    payment_amount DECIMAL(10,2) NOT NULL COMMENT '支付金额（PHP）',
    currency VARCHAR(10) DEFAULT 'PHP' COMMENT '币种',

    -- 状态
    payment_status TINYINT DEFAULT 1 COMMENT '支付状态: 1-待支付 2-支付中 3-支付成功 4-支付失败 5-已取消',

    -- 第三方信息
    third_party_order_no VARCHAR(100) COMMENT '第三方订单号',
    third_party_transaction_id VARCHAR(100) COMMENT '第三方交易ID',
    callback_data JSON COMMENT '支付回调数据（JSON）',

    -- 时间
    paid_at BIGINT COMMENT '支付完成时间戳',
    expired_at BIGINT COMMENT '支付过期时间戳',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX idx_user(user_id),
    INDEX idx_order(order_id),
    INDEX idx_payment_no(payment_no),
    INDEX idx_status(payment_status),
    INDEX idx_third_party(third_party_transaction_id),
    INDEX idx_created_at(created_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='支付记录表';
```

**字段说明：**

| 字段名               | 类型          | 说明         | 示例值                   |
| -------------------- | ------------- | ------------ | ------------------------ |
| payment_id           | BIGINT        | 支付ID       | 584250123456789012       |
| payment_no           | VARCHAR(50)   | 支付流水号   | PAY20250121123456        |
| user_id              | BIGINT        | 用户ID       | 584112257881866250       |
| order_id             | BIGINT        | 订单ID       | 584249482517872846       |
| payment_type         | TINYINT       | 支付类型     | 1-充值 2-购买            |
| payment_method       | TINYINT       | 支付方式     | 1-GCash 2-PayMaya        |
| payment_amount       | DECIMAL(10,2) | 支付金额     | 100.00                   |
| payment_status       | TINYINT       | 支付状态     | 3-支付成功               |
| third_party_order_no | VARCHAR(100)  | 第三方订单号 | GCASH202501211234        |
| callback_data        | JSON          | 回调数据     | {"status":"success",...} |

**业务规则：**

- 支付流水号格式：PAY + 年月日 + 序列号
- 充值时 order_id 为空
- 支付成功后更新订单状态和用户钱包余额
- 支付回调数据使用 JSON 存储，便于后续审计
- 支付过期时间默认为创建后 30 分钟

---

#### 14. refunds - 退款记录表

**表说明：** 存储退款申请和处理记录。

```sql
CREATE TABLE refunds (
    refund_id BIGINT PRIMARY KEY COMMENT '退款ID（雪花ID）',
    refund_no VARCHAR(50) UNIQUE NOT NULL COMMENT '退款单号',
    user_id BIGINT NOT NULL COMMENT '用户ID',
    order_id BIGINT NOT NULL COMMENT '订单ID',
    payment_id BIGINT COMMENT '原支付记录ID',

    -- 退款信息
    refund_type TINYINT NOT NULL COMMENT '退款类型: 1-用户申请 2-系统自动 3-管理员操作',
    refund_reason VARCHAR(500) COMMENT '退款原因',
    refund_amount DECIMAL(10,2) NOT NULL COMMENT '退款金额',
    refund_method TINYINT COMMENT '退款方式: 1-原路退回 2-退到钱包',

    -- 状态
    refund_status TINYINT DEFAULT 1 COMMENT '退款状态: 1-待审核 2-审核通过 3-退款中 4-退款成功 5-已拒绝',
    audit_result VARCHAR(500) COMMENT '审核结果说明',
    reject_reason VARCHAR(500) COMMENT '拒绝原因',

    -- 处理人
    auditor_id BIGINT COMMENT '审核人ID',

    -- 第三方信息
    third_party_refund_no VARCHAR(100) COMMENT '第三方退款单号',
    refund_callback_data JSON COMMENT '退款回调数据',

    -- 时间
    applied_at BIGINT NOT NULL COMMENT '申请时间戳',
    audited_at BIGINT COMMENT '审核时间戳',
    refunded_at BIGINT COMMENT '退款完成时间戳',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX idx_user(user_id),
    INDEX idx_order(order_id),
    INDEX idx_payment(payment_id),
    INDEX idx_status(refund_status),
    INDEX idx_applied_at(applied_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
    FOREIGN KEY (payment_id) REFERENCES payments(payment_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='退款记录表';
```

**字段说明：**

| 字段名        | 类型          | 说明     | 示例值                |
| ------------- | ------------- | -------- | --------------------- |
| refund_id     | BIGINT        | 退款ID   | 584251123456789012    |
| refund_no     | VARCHAR(50)   | 退款单号 | REF20250121123456     |
| user_id       | BIGINT        | 用户ID   | 584112257881866250    |
| order_id      | BIGINT        | 订单ID   | 584249482517872846    |
| refund_type   | TINYINT       | 退款类型 | 1-用户申请            |
| refund_reason | VARCHAR(500)  | 退款原因 | 误操作，需要退款      |
| refund_amount | DECIMAL(10,2) | 退款金额 | 84.50                 |
| refund_method | TINYINT       | 退款方式 | 1-原路退回 2-退到钱包 |
| refund_status | TINYINT       | 退款状态 | 4-退款成功            |

**业务规则：**

- 退款单号格式：REF + 年月日 + 序列号
- 已开奖的订单不可退款
- 退款金额不超过实付金额
- 金币抵扣部分退回金币，现金部分退回现金
- 退款成功后更新订单退款状态

---

#### 15. wallet_transactions - 钱包交易流水表

**表说明：** 记录用户钱包的所有交易明细，包括充值、消费、退款等。

```sql
CREATE TABLE wallet_transactions (
    transaction_id BIGINT PRIMARY KEY COMMENT '交易ID（雪花ID）',
    transaction_no VARCHAR(50) UNIQUE NOT NULL COMMENT '交易流水号',
    user_id BIGINT NOT NULL COMMENT '用户ID',

    -- 交易信息
    transaction_type TINYINT NOT NULL COMMENT '交易类型: 1-充值 2-消费 3-退款 4-奖励 5-提现 6-金币兑换 7-邀请奖励',
    amount DECIMAL(10,2) NOT NULL COMMENT '交易金额（正数为收入，负数为支出）',
    balance_type TINYINT NOT NULL COMMENT '余额类型: 1-现金 2-金币',

    -- 余额快照
    before_balance DECIMAL(10,2) NOT NULL COMMENT '交易前余额',
    after_balance DECIMAL(10,2) NOT NULL COMMENT '交易后余额',

    -- 关联信息
    related_id BIGINT COMMENT '关联业务ID（订单ID/充值ID/提现ID等）',
    related_type VARCHAR(50) COMMENT '关联业务类型',

    -- 描述
    description VARCHAR(500) COMMENT '交易描述',
    remark TEXT COMMENT '备注',

    -- 状态
    status TINYINT DEFAULT 1 COMMENT '状态: 1-成功 2-失败 3-处理中',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    INDEX idx_user(user_id),
    INDEX idx_transaction_no(transaction_no),
    INDEX idx_type(transaction_type),
    INDEX idx_balance_type(balance_type),
    INDEX idx_created_at(created_at),
    INDEX idx_user_type(user_id, transaction_type),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='钱包交易流水表';
```

**字段说明：**

| 字段名           | 类型          | 说明         | 示例值                       |
| ---------------- | ------------- | ------------ | ---------------------------- |
| transaction_id   | BIGINT        | 交易ID       | 584252123456789012           |
| transaction_no   | VARCHAR(50)   | 交易流水号   | TXN20250121123456            |
| user_id          | BIGINT        | 用户ID       | 584112257881866250           |
| transaction_type | TINYINT       | 交易类型     | 1-充值 2-消费                |
| amount           | DECIMAL(10,2) | 交易金额     | 100.00（收入）-50.00（支出） |
| balance_type     | TINYINT       | 余额类型     | 1-现金 2-金币                |
| before_balance   | DECIMAL(10,2) | 交易前余额   | 500.00                       |
| after_balance    | DECIMAL(10,2) | 交易后余额   | 600.00                       |
| related_id       | BIGINT        | 关联业务ID   | 584249482517872846           |
| related_type     | VARCHAR(50)   | 关联业务类型 | order/recharge/withdraw      |
| description      | VARCHAR(500)  | 交易描述     | 购买抽奖票                   |

**业务规则：**

- 交易流水号格式：TXN + 年月日 + 序列号
- 所有钱包余额变动必须记录流水
- amount 为正数表示收入，负数表示支出
- 记录交易前后余额，便于对账和审计
- 交易记录永久保存，不可删除

---

## 表关系图（更新）

```
users (用户表)
├─ user_wallets (1对1: 钱包余额)
│   └─ wallet_transactions (1对多: 交易流水)
├─ user_addresses (1对多: 收货地址)
├─ kyc_records (1对多: KYC认证记录)
├─ user_invitations (1对多: 邀请关系)
├─ treasure_groups (1对多: 创建的组团)
└─ orders (1对多: 订单)
    ├─ order_lucky_codes (1对多: 幸运码)
    ├─ payments (1对多: 支付记录)
    └─ refunds (1对多: 退款记录)

treasures (产品表)
├─ treasure_categories (多对多: 产品分类)
│   └─ product_categories (分类表)
├─ treasure_groups (1对多: 组团)
│   └─ treasure_group_members (1对多: 组团成员)
└─ orders (1对多: 订单)
```

---

### 中奖与发货体系

#### 16. winning_records - 中奖记录表

**表说明：** 存储所有抽奖的中奖记录，是开奖系统的核心表。

```sql
CREATE TABLE winning_records (
    winning_id BIGINT PRIMARY KEY COMMENT '中奖记录ID（雪花ID）',
    treasure_id BIGINT NOT NULL COMMENT '产品ID',
    user_id BIGINT NOT NULL COMMENT '中奖用户ID',
    order_id BIGINT NOT NULL COMMENT '中奖订单ID',

    -- 中奖信息
    lucky_code VARCHAR(50) NOT NULL COMMENT '中奖幸运码',
    winning_type TINYINT NOT NULL COMMENT '奖品类型: 1-实物产品 2-现金奖励',
    prize_name VARCHAR(200) COMMENT '奖品名称',
    prize_value DECIMAL(10,2) COMMENT '奖品价值（PHP）',

    -- 现金奖励
    cash_amount DECIMAL(10,2) COMMENT '现金奖励金额',
    cash_status TINYINT COMMENT '现金发放状态: 0-未发放 1-已发放',
    cash_released_at BIGINT COMMENT '现金发放时间戳',

    -- 物流信息
    delivery_status TINYINT DEFAULT 0 COMMENT '发货状态: 0-待发货 1-已发货 2-运输中 3-已签收 4-异常',
    address_id BIGINT COMMENT '收货地址ID',

    -- 组团分享奖励
    group_id BIGINT COMMENT '所属组团ID',
    share_reward_distributed TINYINT DEFAULT 0 COMMENT '是否已分发组团奖励: 0-否 1-是',

    -- 开奖信息
    lottery_time BIGINT NOT NULL COMMENT '开奖时间戳',
    lottery_algorithm VARCHAR(100) COMMENT '开奖算法（如：SHA256）',
    lottery_seed VARCHAR(255) COMMENT '开奖种子值',

    -- 时间
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX idx_treasure(treasure_id),
    INDEX idx_user(user_id),
    INDEX idx_order(order_id),
    INDEX idx_lucky_code(lucky_code),
    INDEX idx_group(group_id),
    INDEX idx_lottery_time(lottery_time),
    INDEX idx_delivery_status(delivery_status),
    FOREIGN KEY (treasure_id) REFERENCES treasures(treasure_id) ON DELETE RESTRICT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES treasure_groups(group_id) ON DELETE SET NULL,
    FOREIGN KEY (address_id) REFERENCES user_addresses(address_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='中奖记录表';
```

**字段说明：**

| 字段名            | 类型          | 说明         | 示例值             |
| ----------------- | ------------- | ------------ | ------------------ |
| winning_id        | BIGINT        | 中奖记录ID   | 584260123456789012 |
| treasure_id       | BIGINT        | 产品ID       | 10                 |
| user_id           | BIGINT        | 中奖用户ID   | 584112257881866250 |
| order_id          | BIGINT        | 中奖订单ID   | 584249482517872846 |
| lucky_code        | VARCHAR(50)   | 中奖幸运码   | 002365             |
| winning_type      | TINYINT       | 奖品类型     | 1-实物 2-现金      |
| prize_name        | VARCHAR(200)  | 奖品名称     | Realme T300        |
| prize_value       | DECIMAL(10,2) | 奖品价值     | 3200.00            |
| cash_amount       | DECIMAL(10,2) | 现金奖励     | 3200.00            |
| cash_status       | TINYINT       | 现金发放状态 | 1-已发放           |
| delivery_status   | TINYINT       | 发货状态     | 1-已发货           |
| group_id          | BIGINT        | 组团ID       | 584239367690649859 |
| lottery_time      | BIGINT        | 开奖时间戳   | 1757823600000      |
| lottery_algorithm | VARCHAR(100)  | 开奖算法     | SHA256-Random      |

**业务规则：**

- 开奖时随机抽取幸运码生成中奖记录
- 现金奖励直接发放到用户钱包
- 实物产品需要创建物流订单进行配送
- 组员中奖时触发组团奖励分发
- 开奖算法和种子值用于保证公平性和可追溯

---

#### 17. deliveries - 物流配送表

**表说明：** 存储实物产品的物流配送信息。

```sql
CREATE TABLE deliveries (
    delivery_id BIGINT PRIMARY KEY COMMENT '物流ID（雪花ID）',
    delivery_no VARCHAR(50) UNIQUE NOT NULL COMMENT '物流单号',
    winning_id BIGINT NOT NULL COMMENT '中奖记录ID',
    user_id BIGINT NOT NULL COMMENT '用户ID',
    treasure_id BIGINT NOT NULL COMMENT '产品ID',

    -- 收货信息
    receiver_name VARCHAR(100) NOT NULL COMMENT '收货人姓名',
    receiver_phone VARCHAR(20) NOT NULL COMMENT '收货人电话',
    receiver_province VARCHAR(50) NOT NULL COMMENT '省份',
    receiver_city VARCHAR(50) NOT NULL COMMENT '城市',
    receiver_address TEXT NOT NULL COMMENT '详细地址',
    receiver_postal_code VARCHAR(10) COMMENT '邮政编码',

    -- 物流信息
    logistics_company VARCHAR(100) COMMENT '物流公司',
    logistics_no VARCHAR(100) COMMENT '物流单号',
    logistics_status TINYINT DEFAULT 0 COMMENT '物流状态: 0-待发货 1-已发货 2-运输中 3-派送中 4-已签收 5-异常',

    -- 时间
    shipped_at BIGINT COMMENT '发货时间戳',
    delivered_at BIGINT COMMENT '签收时间戳',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX idx_winning(winning_id),
    INDEX idx_user(user_id),
    INDEX idx_delivery_no(delivery_no),
    INDEX idx_logistics_no(logistics_no),
    INDEX idx_status(logistics_status),
    FOREIGN KEY (winning_id) REFERENCES winning_records(winning_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (treasure_id) REFERENCES treasures(treasure_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='物流配送表';
```

**字段说明：**

| 字段名            | 类型         | 说明       | 示例值                      |
| ----------------- | ------------ | ---------- | --------------------------- |
| delivery_id       | BIGINT       | 物流ID     | 584261123456789012          |
| delivery_no       | VARCHAR(50)  | 物流单号   | DLV20250121123456           |
| winning_id        | BIGINT       | 中奖记录ID | 584260123456789012          |
| receiver_name     | VARCHAR(100) | 收货人姓名 | Juan Cruz                   |
| receiver_phone    | VARCHAR(20)  | 收货人电话 | +63 912 345 6789            |
| receiver_address  | TEXT         | 详细地址   | Blk 12 Lot 5, Camella Homes |
| logistics_company | VARCHAR(100) | 物流公司   | LBC Express                 |
| logistics_no      | VARCHAR(100) | 物流单号   | LBC123456789                |
| logistics_status  | TINYINT      | 物流状态   | 4-已签收                    |

**业务规则：**

- 实物产品中奖后自动创建物流记录
- 物流单号格式：DLV + 年月日 + 序列号
- 支持对接第三方物流公司API查询物流状态
- 签收后更新中奖记录的发货状态

---

#### 18. delivery_logs - 物流跟踪日志表

**表说明：** 记录物流配送的详细跟踪信息。

```sql
CREATE TABLE delivery_logs (
    log_id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '日志ID',
    delivery_id BIGINT NOT NULL COMMENT '物流ID',
    logistics_status TINYINT NOT NULL COMMENT '物流状态',
    status_desc VARCHAR(500) COMMENT '状态描述',
    location VARCHAR(200) COMMENT '当前位置',
    operator VARCHAR(100) COMMENT '操作人',
    log_time BIGINT NOT NULL COMMENT '日志时间戳',
    remark TEXT COMMENT '备注',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    INDEX idx_delivery(delivery_id),
    INDEX idx_log_time(log_time),
    FOREIGN KEY (delivery_id) REFERENCES deliveries(delivery_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='物流跟踪日志表';
```

**字段说明：**

| 字段名           | 类型         | 说明       | 示例值                |
| ---------------- | ------------ | ---------- | --------------------- |
| log_id           | BIGINT       | 日志ID     | 1                     |
| delivery_id      | BIGINT       | 物流ID     | 584261123456789012    |
| logistics_status | TINYINT      | 物流状态   | 2-运输中              |
| status_desc      | VARCHAR(500) | 状态描述   | Package is in transit |
| location         | VARCHAR(200) | 当前位置   | Manila Sorting Center |
| operator         | VARCHAR(100) | 操作人     | LBC-Manila            |
| log_time         | BIGINT       | 日志时间戳 | 1757823600000         |

**业务规则：**

- 每次物流状态变化都需要记录日志
- 支持从第三方物流API同步物流信息
- 用户可查看完整的物流跟踪记录
- 日志按时间倒序展示

---

#### 19. coupons - 优惠券表

**表说明：** 存储系统发放的优惠券模板和配置。

```sql
CREATE TABLE coupons (
    coupon_id BIGINT PRIMARY KEY COMMENT '优惠券ID（雪花ID）',
    coupon_name VARCHAR(200) NOT NULL COMMENT '优惠券名称',
    coupon_code VARCHAR(50) UNIQUE COMMENT '优惠券代码（可为空，系统券无代码）',

    -- 优惠券类型
    coupon_type TINYINT NOT NULL COMMENT '优惠券类型: 1-满减券 2-折扣券 3-固定金额券',
    discount_type TINYINT COMMENT '折扣类型: 1-百分比 2-固定金额',

    -- 优惠金额
    discount_value DECIMAL(10,2) NOT NULL COMMENT '折扣值（百分比或固定金额）',
    min_purchase_amount DECIMAL(10,2) DEFAULT 0.00 COMMENT '最低消费金额',
    max_discount_amount DECIMAL(10,2) COMMENT '最大折扣金额（折扣券用）',

    -- 发放规则
    issue_type TINYINT NOT NULL COMMENT '发放类型: 1-系统发放 2-活动领取 3-邀请奖励 4-兑换码',
    total_quantity INT DEFAULT -1 COMMENT '总发行量（-1为不限量）',
    issued_quantity INT DEFAULT 0 COMMENT '已发放数量',
    per_user_limit INT DEFAULT 1 COMMENT '每人限领数量',

    -- 使用规则
    use_scope TINYINT DEFAULT 1 COMMENT '使用范围: 1-全部产品 2-指定分类 3-指定产品',
    scope_value JSON COMMENT '范围值（分类ID或产品ID数组）',

    -- 有效期
    valid_type TINYINT NOT NULL COMMENT '有效期类型: 1-固定日期 2-领取后N天',
    valid_days INT COMMENT '有效天数（valid_type=2时使用）',
    valid_start_time BIGINT COMMENT '有效开始时间戳',
    valid_end_time BIGINT COMMENT '有效结束时间戳',

    -- 状态
    status TINYINT DEFAULT 1 COMMENT '状态: 0-已停用 1-正常 2-已结束',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX idx_coupon_code(coupon_code),
    INDEX idx_status(status),
    INDEX idx_valid_time(valid_start_time, valid_end_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='优惠券表';
```

**字段说明：**

| 字段名              | 类型          | 说明       | 示例值                  |
| ------------------- | ------------- | ---------- | ----------------------- |
| coupon_id           | BIGINT        | 优惠券ID   | 584262123456789012      |
| coupon_name         | VARCHAR(200)  | 优惠券名称 | New User Welcome Coupon |
| coupon_code         | VARCHAR(50)   | 优惠券代码 | WELCOME2025             |
| coupon_type         | TINYINT       | 优惠券类型 | 1-满减券                |
| discount_value      | DECIMAL(10,2) | 折扣值     | 50.00 或 10（10%）      |
| min_purchase_amount | DECIMAL(10,2) | 最低消费   | 200.00                  |
| max_discount_amount | DECIMAL(10,2) | 最大折扣   | 100.00                  |
| issue_type          | TINYINT       | 发放类型   | 1-系统发放              |
| total_quantity      | INT           | 总发行量   | 10000                   |
| per_user_limit      | INT           | 每人限领   | 1                       |
| use_scope           | TINYINT       | 使用范围   | 1-全部 2-指定分类       |
| valid_type          | TINYINT       | 有效期类型 | 1-固定日期 2-领取后N天  |

**业务规则：**

- 满减券：满X元减Y元
- 折扣券：打X折，最高优惠Y元
- 固定金额券：直接减X元
- 使用范围可限制在特定产品或分类
- 有效期支持固定日期和相对日期两种模式

---

#### 20. user_coupons - 用户优惠券表

**表说明：** 存储用户领取和使用优惠券的记录。

```sql
CREATE TABLE user_coupons (
    user_coupon_id BIGINT PRIMARY KEY COMMENT '用户优惠券ID（雪花ID）',
    coupon_id BIGINT NOT NULL COMMENT '优惠券ID',
    user_id BIGINT NOT NULL COMMENT '用户ID',

    -- 领取信息
    receive_type TINYINT NOT NULL COMMENT '领取方式: 1-系统发放 2-主动领取 3-兑换码 4-邀请奖励',
    receive_source VARCHAR(100) COMMENT '领取来源',

    -- 使用信息
    use_status TINYINT DEFAULT 0 COMMENT '使用状态: 0-未使用 1-已使用 2-已过期 3-已作废',
    order_id BIGINT COMMENT '使用的订单ID',
    discount_amount DECIMAL(10,2) COMMENT '实际抵扣金额',

    -- 有效期
    valid_start_time BIGINT NOT NULL COMMENT '有效开始时间戳',
    valid_end_time BIGINT NOT NULL COMMENT '有效结束时间戳',

    -- 时间
    received_at BIGINT NOT NULL COMMENT '领取时间戳',
    used_at BIGINT COMMENT '使用时间戳',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX idx_coupon(coupon_id),
    INDEX idx_user(user_id),
    INDEX idx_user_status(user_id, use_status),
    INDEX idx_order(order_id),
    INDEX idx_valid_time(valid_end_time),
    FOREIGN KEY (coupon_id) REFERENCES coupons(coupon_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户优惠券表';
```

**字段说明：**

| 字段名           | 类型          | 说明         | 示例值             |
| ---------------- | ------------- | ------------ | ------------------ |
| user_coupon_id   | BIGINT        | 用户优惠券ID | 584263123456789012 |
| coupon_id        | BIGINT        | 优惠券ID     | 584262123456789012 |
| user_id          | BIGINT        | 用户ID       | 584112257881866250 |
| receive_type     | TINYINT       | 领取方式     | 1-系统发放         |
| use_status       | TINYINT       | 使用状态     | 0-未使用 1-已使用  |
| order_id         | BIGINT        | 使用订单ID   | 584249482517872846 |
| discount_amount  | DECIMAL(10,2) | 实际抵扣     | 50.00              |
| valid_start_time | BIGINT        | 有效开始时间 | 1757737200000      |
| valid_end_time   | BIGINT        | 有效结束时间 | 1758342000000      |
| received_at      | BIGINT        | 领取时间     | 1757737200000      |
| used_at          | BIGINT        | 使用时间     | 1757823600000      |

**业务规则：**

- 用户领取优惠券后创建记录
- 每张优惠券只能使用一次
- 过期自动标记为已过期状态
- 订单取消后，优惠券返还到用户账户
- 支持定时任务批量更新过期优惠券状态

---

## 表关系图（更新）

```
users (用户表)
├─ user_wallets (1对1: 钱包余额)
│   └─ wallet_transactions (1对多: 交易流水)
├─ user_addresses (1对多: 收货地址)
├─ kyc_records (1对多: KYC认证记录)
├─ user_invitations (1对多: 邀请关系)
├─ treasure_groups (1对多: 创建的组团)
├─ orders (1对多: 订单)
│   ├─ order_lucky_codes (1对多: 幸运码)
│   ├─ payments (1对多: 支付记录)
│   └─ refunds (1对多: 退款记录)
├─ winning_records (1对多: 中奖记录)
│   └─ deliveries (1对1: 物流配送)
│       └─ delivery_logs (1对多: 物流日志)
└─ user_coupons (1对多: 用户优惠券)
    └─ coupons (多对1: 优惠券模板)

treasures (产品表)
├─ treasure_categories (多对多: 产品分类)
│   └─ product_categories (分类表)
├─ treasure_groups (1对多: 组团)
│   └─ treasure_group_members (1对多: 组团成员)
├─ orders (1对多: 订单)
└─ winning_records (1对多: 中奖记录)
```

---

### 提现与充值体系

#### 21. recharge_orders - 充值订单表

**表说明：** 存储用户充值订单信息，用于现金账户充值管理。

```sql
CREATE TABLE recharge_orders (
    recharge_id BIGINT PRIMARY KEY COMMENT '充值ID（雪花ID）',
    recharge_no VARCHAR(50) UNIQUE NOT NULL COMMENT '充值订单号',
    user_id BIGINT NOT NULL COMMENT '用户ID',

    -- 充值金额
    recharge_amount DECIMAL(10,2) NOT NULL COMMENT '充值金额（PHP）',
    bonus_amount DECIMAL(10,2) DEFAULT 0.00 COMMENT '赠送金额',
    actual_amount DECIMAL(10,2) NOT NULL COMMENT '实际到账金额',

    -- 支付信息
    payment_method TINYINT NOT NULL COMMENT '支付方式: 1-GCash 2-PayMaya 3-银行卡 4-其他',
    payment_channel VARCHAR(50) COMMENT '支付渠道',
    payment_id BIGINT COMMENT '支付记录ID',

    -- 状态
    recharge_status TINYINT DEFAULT 1 COMMENT '充值状态: 1-待支付 2-支付中 3-充值成功 4-充值失败 5-已取消',

    -- 活动信息
    activity_id BIGINT COMMENT '参与的充值活动ID',
    first_recharge TINYINT DEFAULT 0 COMMENT '是否首充: 0-否 1-是',

    -- 第三方信息
    third_party_order_no VARCHAR(100) COMMENT '第三方订单号',
    callback_data JSON COMMENT '回调数据',

    -- 时间
    paid_at BIGINT COMMENT '支付完成时间戳',
    completed_at BIGINT COMMENT '充值完成时间戳',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX idx_user(user_id),
    INDEX idx_recharge_no(recharge_no),
    INDEX idx_status(recharge_status),
    INDEX idx_payment(payment_id),
    INDEX idx_created_at(created_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (payment_id) REFERENCES payments(payment_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='充值订单表';
```

**字段说明：**

| 字段名          | 类型          | 说明       | 示例值             |
| --------------- | ------------- | ---------- | ------------------ |
| recharge_id     | BIGINT        | 充值ID     | 584270123456789012 |
| recharge_no     | VARCHAR(50)   | 充值订单号 | RCH20250121123456  |
| user_id         | BIGINT        | 用户ID     | 584112257881866250 |
| recharge_amount | DECIMAL(10,2) | 充值金额   | 1000.00            |
| bonus_amount    | DECIMAL(10,2) | 赠送金额   | 100.00             |
| actual_amount   | DECIMAL(10,2) | 实际到账   | 1100.00            |
| payment_method  | TINYINT       | 支付方式   | 1-GCash            |
| recharge_status | TINYINT       | 充值状态   | 3-充值成功         |
| first_recharge  | TINYINT       | 是否首充   | 1-是               |

**业务规则：**

- 充值订单号格式：RCH + 年月日 + 序列号
- 实际到账 = 充值金额 + 赠送金额
- 首充用户可获得额外奖励
- 充值成功后更新用户钱包余额和交易流水
- 支持充值活动赠送金币或优惠券

---

#### 22. withdraw_orders - 提现订单表

**表说明：** 存储用户提现申请和处理记录。

```sql
CREATE TABLE withdraw_orders (
    withdraw_id BIGINT PRIMARY KEY COMMENT '提现ID（雪花ID）',
    withdraw_no VARCHAR(50) UNIQUE NOT NULL COMMENT '提现订单号',
    user_id BIGINT NOT NULL COMMENT '用户ID',

    -- 提现金额
    withdraw_amount DECIMAL(10,2) NOT NULL COMMENT '提现金额（PHP）',
    fee_amount DECIMAL(10,2) DEFAULT 0.00 COMMENT '手续费',
    actual_amount DECIMAL(10,2) NOT NULL COMMENT '实际到账金额',

    -- 提现方式
    withdraw_method TINYINT NOT NULL COMMENT '提现方式: 1-GCash 2-PayMaya 3-银行卡',
    withdraw_account VARCHAR(100) NOT NULL COMMENT '提现账号',
    account_name VARCHAR(100) COMMENT '账户名',
    bank_name VARCHAR(100) COMMENT '银行名称（银行卡提现用）',

    -- 状态
    withdraw_status TINYINT DEFAULT 1 COMMENT '提现状态: 1-待审核 2-审核通过 3-处理中 4-提现成功 5-审核拒绝 6-提现失败',
    audit_result VARCHAR(500) COMMENT '审核结果',
    reject_reason VARCHAR(500) COMMENT '拒绝原因',

    -- 审核信息
    auditor_id BIGINT COMMENT '审核人ID',

    -- 第三方信息
    third_party_order_no VARCHAR(100) COMMENT '第三方提现单号',
    transfer_voucher VARCHAR(255) COMMENT '转账凭证URL',

    -- 时间
    applied_at BIGINT NOT NULL COMMENT '申请时间戳',
    audited_at BIGINT COMMENT '审核时间戳',
    completed_at BIGINT COMMENT '完成时间戳',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX idx_user(user_id),
    INDEX idx_withdraw_no(withdraw_no),
    INDEX idx_status(withdraw_status),
    INDEX idx_applied_at(applied_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='提现订单表';
```

**字段说明：**

| 字段名           | 类型          | 说明       | 示例值             |
| ---------------- | ------------- | ---------- | ------------------ |
| withdraw_id      | BIGINT        | 提现ID     | 584271123456789012 |
| withdraw_no      | VARCHAR(50)   | 提现订单号 | WTD20250121123456  |
| user_id          | BIGINT        | 用户ID     | 584112257881866250 |
| withdraw_amount  | DECIMAL(10,2) | 提现金额   | 500.00             |
| fee_amount       | DECIMAL(10,2) | 手续费     | 10.00              |
| actual_amount    | DECIMAL(10,2) | 实际到账   | 490.00             |
| withdraw_method  | TINYINT       | 提现方式   | 1-GCash            |
| withdraw_account | VARCHAR(100)  | 提现账号   | 09123456789        |
| account_name     | VARCHAR(100)  | 账户名     | Juan Cruz          |
| withdraw_status  | TINYINT       | 提现状态   | 4-提现成功         |

**业务规则：**

- 提现订单号格式：WTD + 年月日 + 序列号
- 实际到账 = 提现金额 - 手续费
- 提现需要KYC认证通过
- 单笔提现最低金额和手续费可配置
- 提现申请需要人工审核
- 审核通过后扣除用户钱包余额
- 提现成功后记录交易流水

---

#### 23. bank_cards - 用户银行卡表

**表说明：** 存储用户绑定的银行卡信息，用于提现操作。

```sql
CREATE TABLE bank_cards (
    card_id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '银行卡ID',
    user_id BIGINT NOT NULL COMMENT '用户ID',

    -- 银行卡信息
    card_no VARCHAR(50) NOT NULL COMMENT '银行卡号（加密存储）',
    card_no_masked VARCHAR(50) COMMENT '脱敏卡号',
    card_holder_name VARCHAR(100) NOT NULL COMMENT '持卡人姓名',
    bank_name VARCHAR(100) NOT NULL COMMENT '银行名称',
    bank_code VARCHAR(50) COMMENT '银行代码',
    branch_name VARCHAR(200) COMMENT '支行名称',

    -- 状态
    card_status TINYINT DEFAULT 1 COMMENT '状态: 0-已解绑 1-正常 2-审核中 3-审核失败',
    is_default TINYINT DEFAULT 0 COMMENT '是否默认: 0-否 1-是',

    -- 认证信息
    verified TINYINT DEFAULT 0 COMMENT '是否已验证: 0-未验证 1-已验证',
    verified_at BIGINT COMMENT '验证时间戳',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX idx_user(user_id),
    INDEX idx_status(card_status),
    INDEX idx_is_default(user_id, is_default),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户银行卡表';
```

**字段说明：**

| 字段名           | 类型         | 说明             | 示例值                      |
| ---------------- | ------------ | ---------------- | --------------------------- |
| card_id          | BIGINT       | 银行卡ID         | 1                           |
| user_id          | BIGINT       | 用户ID           | 584112257881866250          |
| card_no          | VARCHAR(50)  | 银行卡号（加密） | [encrypted]                 |
| card_no_masked   | VARCHAR(50)  | 脱敏卡号         | \***\* \*\*** \*\*\*\* 1234 |
| card_holder_name | VARCHAR(100) | 持卡人姓名       | Juan Cruz                   |
| bank_name        | VARCHAR(100) | 银行名称         | BDO                         |
| card_status      | TINYINT      | 状态             | 1-正常                      |
| is_default       | TINYINT      | 是否默认         | 1-是                        |
| verified         | TINYINT      | 是否已验证       | 1-已验证                    |

**业务规则：**

- 银行卡号需要加密存储
- 展示时使用脱敏卡号
- 每个用户只能有一张默认银行卡
- 绑定银行卡需要实名验证
- 支持常见菲律宾银行（BDO、BPI、Metrobank等）

---

#### 24. customer_service_messages - 客服消息表

**表说明：** 存储用户与客服的聊天消息记录。

```sql
CREATE TABLE customer_service_messages (
    message_id BIGINT PRIMARY KEY COMMENT '消息ID（雪花ID）',
    session_id BIGINT NOT NULL COMMENT '会话ID',
    user_id BIGINT NOT NULL COMMENT '用户ID',

    -- 消息内容
    sender_type TINYINT NOT NULL COMMENT '发送者类型: 1-用户 2-客服 3-系统',
    sender_id BIGINT COMMENT '发送者ID（客服ID或用户ID）',
    message_type TINYINT NOT NULL COMMENT '消息类型: 1-文本 2-图片 3-系统通知',
    message_content TEXT NOT NULL COMMENT '消息内容',

    -- 附件
    attachment_url VARCHAR(255) COMMENT '附件URL（图片等）',
    attachment_type VARCHAR(50) COMMENT '附件类型',

    -- 状态
    read_status TINYINT DEFAULT 0 COMMENT '已读状态: 0-未读 1-已读',
    read_at BIGINT COMMENT '阅读时间戳',

    -- 时间
    sent_at BIGINT NOT NULL COMMENT '发送时间戳',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    INDEX idx_session(session_id),
    INDEX idx_user(user_id),
    INDEX idx_read_status(read_status),
    INDEX idx_sent_at(sent_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='客服消息表';
```

**字段说明：**

| 字段名          | 类型         | 说明       | 示例值                               |
| --------------- | ------------ | ---------- | ------------------------------------ |
| message_id      | BIGINT       | 消息ID     | 584272123456789012                   |
| session_id      | BIGINT       | 会话ID     | 584272000000000001                   |
| user_id         | BIGINT       | 用户ID     | 584112257881866250                   |
| sender_type     | TINYINT      | 发送者类型 | 1-用户 2-客服                        |
| message_type    | TINYINT      | 消息类型   | 1-文本 2-图片                        |
| message_content | TEXT         | 消息内容   | Hello, I need help                   |
| attachment_url  | VARCHAR(255) | 附件URL    | https://xxx.s3.amazonaws.com/img.jpg |
| read_status     | TINYINT      | 已读状态   | 1-已读                               |
| sent_at         | BIGINT       | 发送时间戳 | 1757823600000                        |

**业务规则：**

- 消息按会话ID分组管理
- 支持文本和图片消息
- 客服和用户可互相发送消息
- 消息已读状态用于提醒
- 支持系统自动回复

---

#### 25. customer_service_sessions - 客服会话表

**表说明：** 存储用户与客服的会话信息。

```sql
CREATE TABLE customer_service_sessions (
    session_id BIGINT PRIMARY KEY COMMENT '会话ID（雪花ID）',
    user_id BIGINT NOT NULL COMMENT '用户ID',

    -- 会话信息
    customer_service_id BIGINT COMMENT '客服ID',
    session_type TINYINT DEFAULT 1 COMMENT '会话类型: 1-在线客服 2-工单 3-投诉',
    issue_category VARCHAR(100) COMMENT '问题分类',

    -- 状态
    session_status TINYINT DEFAULT 1 COMMENT '会话状态: 1-待接入 2-服务中 3-已结束 4-已评价',
    priority TINYINT DEFAULT 2 COMMENT '优先级: 1-高 2-中 3-低',

    -- 评价
    rating TINYINT COMMENT '评分（1-5星）',
    feedback TEXT COMMENT '用户反馈',

    -- 时间
    started_at BIGINT NOT NULL COMMENT '开始时间戳',
    ended_at BIGINT COMMENT '结束时间戳',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX idx_user(user_id),
    INDEX idx_customer_service(customer_service_id),
    INDEX idx_status(session_status),
    INDEX idx_started_at(started_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='客服会话表';
```

**字段说明：**

| 字段名              | 类型         | 说明     | 示例值             |
| ------------------- | ------------ | -------- | ------------------ |
| session_id          | BIGINT       | 会话ID   | 584272000000000001 |
| user_id             | BIGINT       | 用户ID   | 584112257881866250 |
| customer_service_id | BIGINT       | 客服ID   | 100001             |
| session_type        | TINYINT      | 会话类型 | 1-在线客服         |
| issue_category      | VARCHAR(100) | 问题分类 | 支付问题           |
| session_status      | TINYINT      | 会话状态 | 2-服务中           |
| priority            | TINYINT      | 优先级   | 1-高               |
| rating              | TINYINT      | 评分     | 5                  |
| feedback            | TEXT         | 用户反馈 | 服务很好           |
| started_at          | BIGINT       | 开始时间 | 1757823600000      |

**业务规则：**

- 用户发起咨询时创建会话
- 客服接入后更新客服ID和状态
- 会话结束后用户可进行评价
- 支持按问题分类分配客服
- 高优先级会话优先处理
- 会话历史记录保留用于查询

---

## 表关系图（更新）

```
users (用户表)
├─ user_wallets (1对1: 钱包余额)
│   └─ wallet_transactions (1对多: 交易流水)
├─ user_addresses (1对多: 收货地址)
├─ kyc_records (1对多: KYC认证记录)
├─ user_invitations (1对多: 邀请关系)
├─ treasure_groups (1对多: 创建的组团)
├─ orders (1对多: 订单)
│   ├─ order_lucky_codes (1对多: 幸运码)
│   ├─ payments (1对多: 支付记录)
│   └─ refunds (1对多: 退款记录)
├─ winning_records (1对多: 中奖记录)
│   └─ deliveries (1对1: 物流配送)
│       └─ delivery_logs (1对多: 物流日志)
├─ user_coupons (1对多: 用户优惠券)
│   └─ coupons (多对1: 优惠券模板)
├─ recharge_orders (1对多: 充值订单)
├─ withdraw_orders (1对多: 提现订单)
├─ bank_cards (1对多: 银行卡)
└─ customer_service_sessions (1对多: 客服会话)
    └─ customer_service_messages (1对多: 客服消息)

treasures (产品表)
├─ treasure_categories (多对多: 产品分类)
│   └─ product_categories (分类表)
├─ treasure_groups (1对多: 组团)
│   └─ treasure_group_members (1对多: 组团成员)
├─ orders (1对多: 订单)
└─ winning_records (1对多: 中奖记录)
```

---

### 营销活动体系

#### 26. marketing_activities - 营销活动表

**表说明：** 存储系统的各类营销活动配置，包括充值活动、邀请活动等。

```sql
CREATE TABLE marketing_activities (
    activity_id BIGINT PRIMARY KEY COMMENT '活动ID（雪花ID）',
    activity_name VARCHAR(200) NOT NULL COMMENT '活动名称',
    activity_type TINYINT NOT NULL COMMENT '活动类型: 1-充值活动 2-邀请活动 3-签到活动 4-新人活动 5-限时抽奖 6-优惠券活动',

    -- 活动规则
    rule_config JSON NOT NULL COMMENT '活动规则配置（JSON）',
    reward_config JSON COMMENT '奖励配置（JSON）',

    -- 活动范围
    target_user_type TINYINT DEFAULT 0 COMMENT '目标用户: 0-全部 1-新用户 2-VIP用户 3-指定用户',
    target_user_list JSON COMMENT '指定用户ID列表',

    -- 活动限制
    participate_limit INT DEFAULT -1 COMMENT '参与次数限制（-1为不限）',
    total_budget DECIMAL(12,2) COMMENT '活动总预算',
    used_budget DECIMAL(12,2) DEFAULT 0.00 COMMENT '已使用预算',

    -- 展示信息
    banner_image VARCHAR(255) COMMENT '活动横幅图',
    description TEXT COMMENT '活动描述',
    rule_description TEXT COMMENT '规则说明（HTML）',

    -- 时间
    start_time BIGINT NOT NULL COMMENT '活动开始时间戳',
    end_time BIGINT NOT NULL COMMENT '活动结束时间戳',

    -- 状态
    status TINYINT DEFAULT 1 COMMENT '状态: 0-已下线 1-进行中 2-已结束 3-暂停',

    -- 统计
    participate_count INT DEFAULT 0 COMMENT '参与人数',
    reward_count INT DEFAULT 0 COMMENT '发放奖励次数',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX idx_activity_type(activity_type),
    INDEX idx_status(status),
    INDEX idx_time_range(start_time, end_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='营销活动表';
```

**字段说明：**

| 字段名            | 类型          | 说明         | 示例值                              |
| ----------------- | ------------- | ------------ | ----------------------------------- |
| activity_id       | BIGINT        | 活动ID       | 584280123456789012                  |
| activity_name     | VARCHAR(200)  | 活动名称     | New Year Recharge Bonus             |
| activity_type     | TINYINT       | 活动类型     | 1-充值活动                          |
| rule_config       | JSON          | 活动规则     | {"min_amount":100,"bonus_rate":0.1} |
| reward_config     | JSON          | 奖励配置     | {"coins":50,"coupons":[1,2]}        |
| target_user_type  | TINYINT       | 目标用户     | 0-全部 1-新用户                     |
| participate_limit | INT           | 参与次数限制 | 1次/用户                            |
| total_budget      | DECIMAL(12,2) | 活动预算     | 100000.00                           |
| used_budget       | DECIMAL(12,2) | 已用预算     | 25000.00                            |
| start_time        | BIGINT        | 开始时间     | 1757737200000                       |
| end_time          | BIGINT        | 结束时间     | 1758342000000                       |
| status            | TINYINT       | 状态         | 1-进行中                            |
| participate_count | INT           | 参与人数     | 5000                                |

**业务规则：**

- rule_config 存储活动具体规则，如充值金额、赠送比例等
- reward_config 存储奖励内容，如金币、优惠券、VIP等
- 活动预算达到上限后自动结束
- 支持定时自动开启和结束活动
- 活动规则使用JSON存储，灵活配置

**rule_config 示例：**

```json
{
  "recharge_activity": {
    "tiers": [
      { "min_amount": 100, "bonus_rate": 0.1, "extra_coins": 10 },
      { "min_amount": 500, "bonus_rate": 0.15, "extra_coins": 100 },
      { "min_amount": 1000, "bonus_rate": 0.2, "extra_coins": 300 }
    ]
  },
  "invite_activity": {
    "inviter_reward": { "coins": 50, "coupon_id": 1001 },
    "invitee_reward": { "coins": 100, "coupon_id": 1002 },
    "condition": "first_recharge"
  }
}
```

---

#### 27. user_activity_records - 用户活动参与记录表

**表说明：** 记录用户参与营销活动的详细信息和获得的奖励。

```sql
CREATE TABLE user_activity_records (
    record_id BIGINT PRIMARY KEY COMMENT '记录ID（雪花ID）',
    activity_id BIGINT NOT NULL COMMENT '活动ID',
    user_id BIGINT NOT NULL COMMENT '用户ID',

    -- 参与信息
    participate_type TINYINT NOT NULL COMMENT '参与方式: 1-主动参与 2-自动参与 3-邀请参与',
    related_id BIGINT COMMENT '关联业务ID（订单ID/充值ID等）',
    related_type VARCHAR(50) COMMENT '关联业务类型',

    -- 奖励信息
    reward_type TINYINT NOT NULL COMMENT '奖励类型: 1-金币 2-现金 3-优惠券 4-VIP 5-抽奖次数',
    reward_amount DECIMAL(10,2) COMMENT '奖励金额/数量',
    reward_detail JSON COMMENT '奖励详情（JSON）',

    -- 发放状态
    reward_status TINYINT DEFAULT 0 COMMENT '奖励状态: 0-待发放 1-已发放 2-发放失败',
    reward_sent_at BIGINT COMMENT '奖励发放时间戳',

    -- 条件完成
    condition_met TINYINT DEFAULT 1 COMMENT '是否满足条件: 0-不满足 1-满足',
    condition_desc VARCHAR(500) COMMENT '条件说明',

    participated_at BIGINT NOT NULL COMMENT '参与时间戳',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    INDEX idx_activity(activity_id),
    INDEX idx_user(user_id),
    INDEX idx_user_activity(user_id, activity_id),
    INDEX idx_reward_status(reward_status),
    INDEX idx_participated_at(participated_at),
    FOREIGN KEY (activity_id) REFERENCES marketing_activities(activity_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户活动参与记录表';
```

**字段说明：**

| 字段名           | 类型          | 说明         | 示例值                            |
| ---------------- | ------------- | ------------ | --------------------------------- |
| record_id        | BIGINT        | 记录ID       | 584281123456789012                |
| activity_id      | BIGINT        | 活动ID       | 584280123456789012                |
| user_id          | BIGINT        | 用户ID       | 584112257881866250                |
| participate_type | TINYINT       | 参与方式     | 1-主动参与                        |
| related_id       | BIGINT        | 关联业务ID   | 584270123456789012                |
| related_type     | VARCHAR(50)   | 关联类型     | recharge_order                    |
| reward_type      | TINYINT       | 奖励类型     | 1-金币 2-现金                     |
| reward_amount    | DECIMAL(10,2) | 奖励金额     | 100.00                            |
| reward_detail    | JSON          | 奖励详情     | {"coins":100,"coupon_ids":[1001]} |
| reward_status    | TINYINT       | 奖励状态     | 1-已发放                          |
| condition_met    | TINYINT       | 是否满足条件 | 1-满足                            |
| participated_at  | BIGINT        | 参与时间     | 1757823600000                     |

**业务规则：**

- 用户参与活动时自动创建记录
- 满足活动条件后自动发放奖励
- 奖励发放后更新用户钱包或优惠券
- 记录用于活动统计和数据分析
- 支持活动奖励延迟发放

---

#### 28. system_notifications - 系统通知表

**表说明：** 存储系统发送给用户的各类通知消息。

```sql
CREATE TABLE system_notifications (
    notification_id BIGINT PRIMARY KEY COMMENT '通知ID（雪花ID）',

    -- 通知类型
    notification_type TINYINT NOT NULL COMMENT '通知类型: 1-系统公告 2-订单通知 3-中奖通知 4-活动通知 5-钱包通知 6-物流通知',
    notification_category TINYINT COMMENT '通知分类: 1-交易 2-营销 3-服务',

    -- 接收对象
    receiver_type TINYINT NOT NULL COMMENT '接收类型: 1-全部用户 2-指定用户 3-用户分组',
    receiver_id BIGINT COMMENT '接收用户ID（receiver_type=2时使用）',
    receiver_group JSON COMMENT '接收用户组（receiver_type=3时使用）',

    -- 通知内容
    title VARCHAR(200) NOT NULL COMMENT '通知标题',
    content TEXT NOT NULL COMMENT '通知内容',
    content_en TEXT COMMENT '英文内容',
    thumbnail VARCHAR(255) COMMENT '缩略图',
    jump_url VARCHAR(500) COMMENT '跳转链接',
    jump_type TINYINT COMMENT '跳转类型: 1-H5页面 2-APP内页 3-外部链接',

    -- 关联信息
    related_id BIGINT COMMENT '关联业务ID',
    related_type VARCHAR(50) COMMENT '关联业务类型',

    -- 推送配置
    push_type TINYINT DEFAULT 1 COMMENT '推送方式: 1-站内信 2-推送通知 3-短信 4-邮件',
    push_immediately TINYINT DEFAULT 1 COMMENT '是否立即推送: 0-否 1-是',
    scheduled_time BIGINT COMMENT '定时推送时间戳',

    -- 状态
    status TINYINT DEFAULT 1 COMMENT '状态: 0-草稿 1-待发送 2-已发送 3-已撤回',

    -- 统计
    send_count INT DEFAULT 0 COMMENT '发送数量',
    read_count INT DEFAULT 0 COMMENT '已读数量',
    click_count INT DEFAULT 0 COMMENT '点击数量',

    sent_at BIGINT COMMENT '发送时间戳',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX idx_receiver(receiver_id),
    INDEX idx_notification_type(notification_type),
    INDEX idx_status(status),
    INDEX idx_sent_at(sent_at),
    INDEX idx_scheduled_time(scheduled_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统通知表';
```

**字段说明：**

| 字段名            | 类型         | 说明       | 示例值                                 |
| ----------------- | ------------ | ---------- | -------------------------------------- |
| notification_id   | BIGINT       | 通知ID     | 584282123456789012                     |
| notification_type | TINYINT      | 通知类型   | 3-中奖通知                             |
| receiver_type     | TINYINT      | 接收类型   | 2-指定用户                             |
| receiver_id       | BIGINT       | 接收用户ID | 584112257881866250                     |
| title             | VARCHAR(200) | 通知标题   | Congratulations! You won!              |
| content           | TEXT         | 通知内容   | You won the Realme T300...             |
| thumbnail         | VARCHAR(255) | 缩略图     | https://xxx.s3.amazonaws.com/notif.jpg |
| jump_url          | VARCHAR(500) | 跳转链接   | /winning/detail?id=123                 |
| jump_type         | TINYINT      | 跳转类型   | 2-APP内页                              |
| related_id        | BIGINT       | 关联ID     | 584260123456789012                     |
| related_type      | VARCHAR(50)  | 关联类型   | winning_record                         |
| push_type         | TINYINT      | 推送方式   | 2-推送通知                             |
| status            | TINYINT      | 状态       | 2-已发送                               |
| send_count        | INT          | 发送数量   | 1                                      |
| read_count        | INT          | 已读数量   | 1                                      |

**业务规则：**

- 支持站内信、推送通知、短信、邮件多种推送方式
- 全局通知（receiver_type=1）自动推送给所有用户
- 支持定时推送功能
- 通知支持多语言（中文、英文、塔加洛语）
- 记录发送、阅读、点击统计用于效果分析
- 未读通知在APP首页显示红点提示

**receiver_group 示例：**

```json
{
  "conditions": [
    { "field": "vip_level", "operator": ">=", "value": 1 },
    { "field": "kyc_status", "operator": "=", "value": 4 }
  ],
  "logic": "AND"
}
```

---

#### 29. user_notifications - 用户通知记录表

**表说明：** 存储用户接收到的通知详情和阅读状态。

```sql
CREATE TABLE user_notifications (
    id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '记录ID',
    notification_id BIGINT NOT NULL COMMENT '通知ID',
    user_id BIGINT NOT NULL COMMENT '用户ID',

    -- 阅读状态
    read_status TINYINT DEFAULT 0 COMMENT '阅读状态: 0-未读 1-已读',
    read_at BIGINT COMMENT '阅读时间戳',

    -- 点击状态
    clicked TINYINT DEFAULT 0 COMMENT '是否点击: 0-未点击 1-已点击',
    clicked_at BIGINT COMMENT '点击时间戳',

    -- 删除状态
    deleted TINYINT DEFAULT 0 COMMENT '是否删除: 0-否 1-是',
    deleted_at BIGINT COMMENT '删除时间戳',

    -- 推送状态
    push_status TINYINT DEFAULT 0 COMMENT '推送状态: 0-待推送 1-已推送 2-推送失败',
    push_result VARCHAR(500) COMMENT '推送结果说明',
    pushed_at BIGINT COMMENT '推送时间戳',

    received_at BIGINT NOT NULL COMMENT '接收时间戳',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    UNIQUE KEY uk_notification_user(notification_id, user_id),
    INDEX idx_notification(notification_id),
    INDEX idx_user_read(user_id, read_status),
    INDEX idx_user_deleted(user_id, deleted),
    INDEX idx_push_status(push_status),
    FOREIGN KEY (notification_id) REFERENCES system_notifications(notification_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户通知记录表';
```

**字段说明：**

| 字段名          | 类型         | 说明     | 示例值             |
| --------------- | ------------ | -------- | ------------------ |
| id              | BIGINT       | 记录ID   | 1                  |
| notification_id | BIGINT       | 通知ID   | 584282123456789012 |
| user_id         | BIGINT       | 用户ID   | 584112257881866250 |
| read_status     | TINYINT      | 阅读状态 | 1-已读             |
| read_at         | BIGINT       | 阅读时间 | 1757823600000      |
| clicked         | TINYINT      | 是否点击 | 1-已点击           |
| clicked_at      | BIGINT       | 点击时间 | 1757823700000      |
| deleted         | TINYINT      | 是否删除 | 0-否               |
| push_status     | TINYINT      | 推送状态 | 1-已推送           |
| push_result     | VARCHAR(500) | 推送结果 | success            |
| received_at     | BIGINT       | 接收时间 | 1757823600000      |

**业务规则：**

- 系统通知发送时，为目标用户批量创建记录
- 用户查看通知列表时只显示未删除的记录
- 未读通知数用于APP角标提示
- 用户删除通知只是软删除，不实际删除记录
- 推送失败的通知支持重试机制
- 记录用于统计通知触达率和点击率

---

#### 30. sign_in_records - 签到记录表

**表说明：** 存储用户每日签到记录和奖励发放。

```sql
CREATE TABLE sign_in_records (
    record_id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '记录ID',
    user_id BIGINT NOT NULL COMMENT '用户ID',

    -- 签到信息
    sign_in_date DATE NOT NULL COMMENT '签到日期',
    continuous_days INT DEFAULT 1 COMMENT '连续签到天数',
    total_days INT DEFAULT 1 COMMENT '累计签到天数',

    -- 奖励信息
    reward_type TINYINT NOT NULL COMMENT '奖励类型: 1-金币 2-优惠券 3-抽奖次数',
    reward_amount DECIMAL(10,2) COMMENT '奖励数量',
    reward_detail JSON COMMENT '奖励详情',

    -- 发放状态
    reward_status TINYINT DEFAULT 0 COMMENT '奖励状态: 0-待发放 1-已发放',
    reward_sent_at BIGINT COMMENT '奖励发放时间戳',

    -- 补签
    is_补签 TINYINT DEFAULT 0 COMMENT '是否补签: 0-正常签到 1-补签',

    signed_at BIGINT NOT NULL COMMENT '签到时间戳',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    UNIQUE KEY uk_user_date(user_id, sign_in_date),
    INDEX idx_user(user_id),
    INDEX idx_sign_in_date(sign_in_date),
    INDEX idx_continuous_days(continuous_days),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='签到记录表';
```

**字段说明：**

| 字段名          | 类型          | 说明         | 示例值                       |
| --------------- | ------------- | ------------ | ---------------------------- |
| record_id       | BIGINT        | 记录ID       | 1                            |
| user_id         | BIGINT        | 用户ID       | 584112257881866250           |
| sign_in_date    | DATE          | 签到日期     | 2025-01-21                   |
| continuous_days | INT           | 连续签到天数 | 7                            |
| total_days      | INT           | 累计签到天数 | 30                           |
| reward_type     | TINYINT       | 奖励类型     | 1-金币                       |
| reward_amount   | DECIMAL(10,2) | 奖励数量     | 10.00                        |
| reward_detail   | JSON          | 奖励详情     | {"coins":10,"extra_bonus":5} |
| reward_status   | TINYINT       | 奖励状态     | 1-已发放                     |
| is\_补签        | TINYINT       | 是否补签     | 0-正常签到                   |
| signed_at       | BIGINT        | 签到时间戳   | 1757823600000                |

**业务规则：**

- 每天只能签到一次（以日期为准）
- 连续签到天数越多，奖励越丰厚
- 断签后连续天数清零
- 支持补签功能（消耗金币或优惠券）
- 签到奖励阶梯式递增
- 连续签到7天、30天有额外奖励

**签到奖励配置示例：**

```json
{
  "daily_rewards": [
    { "day": 1, "coins": 5 },
    { "day": 2, "coins": 5 },
    { "day": 3, "coins": 10 },
    { "day": 4, "coins": 10 },
    { "day": 5, "coins": 15 },
    { "day": 6, "coins": 15 },
    { "day": 7, "coins": 50, "extra": { "coupon_id": 1001 } }
  ],
  "milestone_rewards": [
    { "total_days": 30, "reward": { "coins": 200, "coupon_id": 1002 } },
    { "total_days": 100, "reward": { "coins": 1000, "vip_days": 7 } }
  ]
}
```

---

## 表关系图（更新）

```
users (用户表)
├─ user_wallets (1对1: 钱包余额)
│   └─ wallet_transactions (1对多: 交易流水)
├─ user_addresses (1对多: 收货地址)
├─ kyc_records (1对多: KYC认证记录)
├─ user_invitations (1对多: 邀请关系)
├─ treasure_groups (1对多: 创建的组团)
├─ orders (1对多: 订单)
│   ├─ order_lucky_codes (1对多: 幸运码)
│   ├─ payments (1对多: 支付记录)
│   └─ refunds (1对多: 退款记录)
├─ winning_records (1对多: 中奖记录)
│   └─ deliveries (1对1: 物流配送)
│       └─ delivery_logs (1对多: 物流日志)
├─ user_coupons (1对多: 用户优惠券)
│   └─ coupons (多对1: 优惠券模板)
├─ recharge_orders (1对多: 充值订单)
├─ withdraw_orders (1对多: 提现订单)
├─ bank_cards (1对多: 银行卡)
├─ customer_service_sessions (1对多: 客服会话)
│   └─ customer_service_messages (1对多: 客服消息)
├─ user_activity_records (1对多: 活动参与记录)
│   └─ marketing_activities (多对1: 营销活动)
├─ user_notifications (1对多: 用户通知记录)
│   └─ system_notifications (多对1: 系统通知)
└─ sign_in_records (1对多: 签到记录)

treasures (产品表)
├─ treasure_categories (多对多: 产品分类)
│   └─ product_categories (分类表)
├─ treasure_groups (1对多: 组团)
│   └─ treasure_group_members (1对多: 组团成员)
├─ orders (1对多: 订单)
└─ winning_records (1对多: 中奖记录)
```

---

### 系统管理体系

#### 31. system_config - 系统配置表

**表说明：** 存储系统的全局配置参数，支持动态配置修改。

```sql
CREATE TABLE system_config (
    config_id INT PRIMARY KEY AUTO_INCREMENT COMMENT '配置ID',
    config_key VARCHAR(100) UNIQUE NOT NULL COMMENT '配置键名',
    config_value TEXT COMMENT '配置值',
    config_type TINYINT NOT NULL COMMENT '配置类型: 1-字符串 2-数字 3-布尔 4-JSON',

    -- 配置分类
    config_group VARCHAR(50) NOT NULL COMMENT '配置分组: system/payment/lottery/marketing',
    config_name VARCHAR(200) NOT NULL COMMENT '配置名称',
    config_desc TEXT COMMENT '配置说明',

    -- 编辑限制
    editable TINYINT DEFAULT 1 COMMENT '是否可编辑: 0-不可编辑 1-可编辑',
    need_restart TINYINT DEFAULT 0 COMMENT '修改后是否需要重启: 0-否 1-是',

    -- 默认值
    default_value TEXT COMMENT '默认值',

    -- 状态
    status TINYINT DEFAULT 1 COMMENT '状态: 0-禁用 1-启用',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX idx_config_group(config_group),
    INDEX idx_status(status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统配置表';
```

**字段说明：**

| 字段名        | 类型         | 说明         | 示例值                   |
| ------------- | ------------ | ------------ | ------------------------ |
| config_id     | INT          | 配置ID       | 1                        |
| config_key    | VARCHAR(100) | 配置键名     | min_withdraw_amount      |
| config_value  | TEXT         | 配置值       | 100                      |
| config_type   | TINYINT      | 配置类型     | 2-数字                   |
| config_group  | VARCHAR(50)  | 配置分组     | payment                  |
| config_name   | VARCHAR(200) | 配置名称     | 最低提现金额             |
| config_desc   | TEXT         | 配置说明     | 用户单次提现最低金额限制 |
| editable      | TINYINT      | 是否可编辑   | 1-可编辑                 |
| need_restart  | TINYINT      | 是否需要重启 | 0-否                     |
| default_value | TEXT         | 默认值       | 100                      |
| status        | TINYINT      | 状态         | 1-启用                   |

**业务规则：**

- 配置按分组管理：系统配置、支付配置、抽奖配置、营销配置等
- 支持热更新，部分配置修改后无需重启
- 关键配置设置为不可编辑，防止误操作
- 配置支持版本回滚
- 配置变更需记录操作日志

**常用配置示例：**

```json
// 支付配置
{
  "min_recharge_amount": 50,
  "max_recharge_amount": 50000,
  "min_withdraw_amount": 100,
  "max_withdraw_amount": 10000,
  "withdraw_fee_rate": 0.02,
  "daily_withdraw_limit": 3
}

// 抽奖配置
{
  "min_treasure_price": 1,
  "max_per_user_buy": 1000,
  "lottery_delay_hours": 24,
  "auto_lottery_enabled": true
}

// 金币配置
{
  "coin_to_cash_rate": 10,
  "daily_signin_coins": 5,
  "invite_reward_coins": 100,
  "max_coin_discount_rate": 0.5
}

// KYC配置
{
  "kyc_required_for_purchase": true,
  "kyc_required_for_withdraw": true,
  "max_amount_without_kyc": 1000
}
```

---

#### 32. admin_users - 管理员账户表

**表说明：** 存储后台管理员和客服人员的账户信息。

```sql
CREATE TABLE admin_users (
    admin_id BIGINT PRIMARY KEY COMMENT '管理员ID（雪花ID）',
    username VARCHAR(50) UNIQUE NOT NULL COMMENT '用户名',
    password VARCHAR(255) NOT NULL COMMENT '密码（加密）',
    salt VARCHAR(50) COMMENT '密码盐值',

    -- 基本信息
    real_name VARCHAR(100) COMMENT '真实姓名',
    email VARCHAR(100) COMMENT '邮箱',
    phone VARCHAR(20) COMMENT '手机号',
    avatar VARCHAR(255) COMMENT '头像',

    -- 角色权限
    role_id INT NOT NULL COMMENT '角色ID',
    role_name VARCHAR(50) COMMENT '角色名称',
    permissions JSON COMMENT '权限列表（JSON数组）',

    -- 账户状态
    status TINYINT DEFAULT 1 COMMENT '状态: 0-禁用 1-正常 2-锁定',
    is_super_admin TINYINT DEFAULT 0 COMMENT '是否超级管理员: 0-否 1-是',

    -- 登录信息
    last_login_at BIGINT COMMENT '最后登录时间戳',
    last_login_ip VARCHAR(50) COMMENT '最后登录IP',
    login_count INT DEFAULT 0 COMMENT '登录次数',

    -- 安全
    failed_login_count INT DEFAULT 0 COMMENT '连续失败登录次数',
    locked_until BIGINT COMMENT '锁定截止时间戳',

    -- 备注
    remark TEXT COMMENT '备注',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX idx_username(username),
    INDEX idx_role(role_id),
    INDEX idx_status(status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管理员账户表';
```

**字段说明：**

| 字段名             | 类型         | 说明         | 示例值                     |
| ------------------ | ------------ | ------------ | -------------------------- |
| admin_id           | BIGINT       | 管理员ID     | 584290123456789012         |
| username           | VARCHAR(50)  | 用户名       | admin001                   |
| password           | VARCHAR(255) | 密码（加密） | $2b$10$...                 |
| real_name          | VARCHAR(100) | 真实姓名     | John Smith                 |
| email              | VARCHAR(100) | 邮箱         | admin@example.com          |
| phone              | VARCHAR(20)  | 手机号       | +63 912 345 6789           |
| role_id            | INT          | 角色ID       | 1                          |
| role_name          | VARCHAR(50)  | 角色名称     | 超级管理员                 |
| permissions        | JSON         | 权限列表     | ["user:view","order:edit"] |
| status             | TINYINT      | 状态         | 1-正常                     |
| is_super_admin     | TINYINT      | 是否超管     | 1-是                       |
| last_login_at      | BIGINT       | 最后登录时间 | 1757823600000              |
| failed_login_count | INT          | 失败次数     | 0                          |

**业务规则：**

- 密码使用bcrypt加密存储
- 连续登录失败5次自动锁定账户30分钟
- 超级管理员拥有所有权限
- 普通管理员权限由角色控制
- 管理员操作需记录审计日志
- 支持多角色管理：超级管理员、运营、财务、客服等

**角色权限示例：**

```json
{
  "super_admin": ["*:*"],
  "operation": [
    "user:view",
    "user:edit",
    "user:kyc",
    "treasure:view",
    "treasure:edit",
    "treasure:lottery",
    "order:view",
    "order:refund",
    "activity:view",
    "activity:edit",
    "notification:send"
  ],
  "finance": [
    "user:view",
    "order:view",
    "order:export",
    "payment:view",
    "payment:export",
    "recharge:view",
    "withdraw:audit",
    "refund:audit",
    "report:view"
  ],
  "customer_service": [
    "user:view",
    "order:view",
    "ticket:view",
    "ticket:reply",
    "notification:view"
  ]
}
```

---

#### 33. admin_operation_logs - 管理员操作日志表

**表说明：** 记录管理员在后台的所有操作行为，用于审计和追溯。

```sql
CREATE TABLE admin_operation_logs (
    log_id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '日志ID',
    admin_id BIGINT NOT NULL COMMENT '管理员ID',
    admin_name VARCHAR(100) COMMENT '管理员名称',

    -- 操作信息
    operation_type TINYINT NOT NULL COMMENT '操作类型: 1-查询 2-新增 3-修改 4-删除 5-审核 6-导出',
    operation_module VARCHAR(50) NOT NULL COMMENT '操作模块',
    operation_action VARCHAR(100) NOT NULL COMMENT '操作动作',
    operation_desc TEXT COMMENT '操作描述',

    -- 请求信息
    request_method VARCHAR(10) COMMENT '请求方法: GET/POST/PUT/DELETE',
    request_url VARCHAR(500) COMMENT '请求URL',
    request_params TEXT COMMENT '请求参数（JSON）',
    request_ip VARCHAR(50) COMMENT '请求IP',
    user_agent TEXT COMMENT 'User-Agent',

    -- 响应信息
    response_status INT COMMENT '响应状态码',
    response_data TEXT COMMENT '响应数据（敏感信息脱敏）',
    response_time INT COMMENT '响应时间（毫秒）',

    -- 业务关联
    related_id BIGINT COMMENT '关联业务ID',
    related_type VARCHAR(50) COMMENT '关联业务类型',

    -- 变更记录
    before_data JSON COMMENT '变更前数据',
    after_data JSON COMMENT '变更后数据',

    -- 结果
    is_success TINYINT DEFAULT 1 COMMENT '是否成功: 0-失败 1-成功',
    error_message TEXT COMMENT '错误信息',

    operation_time BIGINT NOT NULL COMMENT '操作时间戳',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    INDEX idx_admin(admin_id),
    INDEX idx_operation_type(operation_type),
    INDEX idx_operation_module(operation_module),
    INDEX idx_operation_time(operation_time),
    INDEX idx_related(related_type, related_id),
    FOREIGN KEY (admin_id) REFERENCES admin_users(admin_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管理员操作日志表';
```

**字段说明：**

| 字段名           | 类型         | 说明       | 示例值                      |
| ---------------- | ------------ | ---------- | --------------------------- |
| log_id           | BIGINT       | 日志ID     | 1                           |
| admin_id         | BIGINT       | 管理员ID   | 584290123456789012          |
| admin_name       | VARCHAR(100) | 管理员名称 | admin001                    |
| operation_type   | TINYINT      | 操作类型   | 3-修改                      |
| operation_module | VARCHAR(50)  | 操作模块   | user_management             |
| operation_action | VARCHAR(100) | 操作动作   | update_kyc_status           |
| operation_desc   | TEXT         | 操作描述   | 审核通过用户KYC认证         |
| request_method   | VARCHAR(10)  | 请求方法   | POST                        |
| request_url      | VARCHAR(500) | 请求URL    | /api/admin/user/kyc/approve |
| request_params   | TEXT         | 请求参数   | {"user_id":123,"status":4}  |
| request_ip       | VARCHAR(50)  | 请求IP     | 192.168.1.100               |
| response_status  | INT          | 响应状态码 | 200                         |
| response_time    | INT          | 响应时间   | 150                         |
| related_id       | BIGINT       | 关联业务ID | 584112257881866250          |
| related_type     | VARCHAR(50)  | 关联类型   | user                        |
| before_data      | JSON         | 变更前     | {"kyc_status":1}            |
| after_data       | JSON         | 变更后     | {"kyc_status":4}            |
| is_success       | TINYINT      | 是否成功   | 1-成功                      |
| operation_time   | BIGINT       | 操作时间   | 1757823600000               |

**业务规则：**

- 记录所有管理员的增删改操作
- 敏感操作（如审核、删除）必须记录
- 变更记录保存修改前后的数据对比
- 日志数据定期归档，不可删除
- 支持按管理员、模块、时间范围查询
- 异常操作触发告警通知

**操作模块分类：**

```
user_management - 用户管理
  - update_user_info: 修改用户信息
  - approve_kyc: KYC审核
  - adjust_balance: 调整余额
  - ban_user: 封禁用户

treasure_management - 产品管理
  - create_treasure: 创建产品
  - update_treasure: 修改产品
  - execute_lottery: 执行开奖

order_management - 订单管理
  - cancel_order: 取消订单
  - approve_refund: 退款审核

finance_management - 财务管理
  - approve_withdraw: 提现审核
  - export_financial_report: 导出财务报表

system_management - 系统管理
  - update_config: 修改系统配置
  - create_admin: 创建管理员
  - send_notification: 发送通知
```

---

## 完整表关系图

```
users (用户表) - 核心表
├─ user_wallets (1对1: 钱包余额)
│   └─ wallet_transactions (1对多: 交易流水)
├─ user_addresses (1对多: 收货地址)
├─ kyc_records (1对多: KYC认证记录)
├─ user_invitations (1对多: 邀请关系)
├─ treasure_groups (1对多: 创建的组团)
├─ orders (1对多: 订单)
│   ├─ order_lucky_codes (1对多: 幸运码)
│   ├─ payments (1对多: 支付记录)
│   └─ refunds (1对多: 退款记录)
├─ winning_records (1对多: 中奖记录)
│   └─ deliveries (1对1: 物流配送)
│       └─ delivery_logs (1对多: 物流日志)
├─ user_coupons (1对多: 用户优惠券)
│   └─ coupons (多对1: 优惠券模板)
├─ recharge_orders (1对多: 充值订单)
├─ withdraw_orders (1对多: 提现订单)
├─ bank_cards (1对多: 银行卡)
├─ customer_service_sessions (1对多: 客服会话)
│   └─ customer_service_messages (1对多: 客服消息)
├─ user_activity_records (1对多: 活动参与记录)
│   └─ marketing_activities (多对1: 营销活动)
├─ user_notifications (1对多: 用户通知记录)
│   └─ system_notifications (多对1: 系统通知)
└─ sign_in_records (1对多: 签到记录)

treasures (产品表) - 核心表
├─ treasure_categories (多对多: 产品分类)
│   └─ product_categories (分类表)
├─ treasure_groups (1对多: 组团)
│   └─ treasure_group_members (1对多: 组团成员)
├─ orders (1对多: 订单)
└─ winning_records (1对多: 中奖记录)

admin_users (管理员表)
└─ admin_operation_logs (1对多: 操作日志)

system_config (系统配置表) - 独立表
```

---

## 数据库索引策略总结

### 高频查询索引

1. **用户相关：** `idx_phone`, `idx_invite_code`, `idx_kyc_status`
2. **订单相关：** `idx_user`, `idx_order_no`, `idx_status`, `idx_created_at`
3. **产品相关：** `idx_lottery_mode`, `idx_lottery_time`, `idx_state`
4. **支付相关：** `idx_payment_no`, `idx_status`, `idx_third_party`
5. **钱包相关：** `idx_user`, `idx_transaction_type`, `idx_created_at`

### 复合索引

1. **用户状态查询：** `idx_user_status(user_id, kyc_status)`
2. **订单状态查询：** `idx_status(order_status, pay_status)`
3. **通知已读查询：** `idx_user_read(user_id, read_status)`
4. **活动参与查询：** `idx_user_activity(user_id, activity_id)`

### 唯一索引

1. **业务单号：** `order_no`, `payment_no`, `refund_no`, `withdraw_no`
2. **邀请码：** `invite_code`
3. **优惠券代码：** `coupon_code`
4. **管理员用户名：** `username`

---

## 数据安全与备份策略

### 数据加密

1. **密码加密：** bcrypt加密存储
2. **银行卡号：** AES加密存储，展示时脱敏
3. **手机号：** 存储MD5用于查重
4. **身份证号：** OCR结果加密存储

### 备份策略

1. **全量备份：** 每天凌晨2点全量备份
2. **增量备份：** 每小时增量备份
3. **归档策略：**
   - 交易数据永久保存
   - 日志数据保存1年后归档
   - 用户行为数据保存6个月

### 数据权限

1. **读写分离：** 主库写入，从库查询
2. **敏感数据：** 限制查询权限
3. **数据导出：** 需要审批和日志记录
4. **SQL注入防护：** 使用ORM或预编译语句

---

## 性能优化建议

### 分库分表策略

1. **订单表：** 按月分表 `orders_202501`, `orders_202502`
2. **流水表：** 按月分表 `wallet_transactions_202501`
3. **日志表：** 按月分表 `admin_operation_logs_202501`
4. **用户表：** 达到1000万后考虑分库

### 缓存策略

1. **热点数据：**
   - 产品信息缓存1小时
   - 用户钱包余额缓存5分钟
   - 系统配置缓存30分钟
2. **计数器：** 使用Redis存储实时统计
3. **分布式锁：** 防止并发操作（抽奖、扣款）

### 查询优化

1. **避免全表扫描：** 所有查询都使用索引
2. **分页查询：** 大数据量使用游标分页
3. **批量操作：** 批量插入、批量更新
4. **读写分离：** 统计查询走从库

---

## 总结

本数据库设计文档完整涵盖了抽奖电商系统的所有核心功能模块：

### 📊 **6大核心体系，33张数据表**

1. **用户体系（5张表）**
   - 用户注册登录、KYC认证、地址管理、邀请关系、钱包余额

2. **产品抽奖体系（5张表）**
   - 产品管理、分类管理、组团功能、购买管理

3. **订单交易体系（5张表）**
   - 订单管理、支付处理、退款管理、幸运码生成、交易流水

4. **中奖发货与优惠券体系（5张表）**
   - 中奖记录、物流配送、物流跟踪、优惠券管理、用户优惠券

5. **提现充值与客服体系（5张表）**
   - 充值订单、提现订单、银行卡管理、客服会话、客服消息

6. **营销活动与通知体系（5张表）**
   - 营销活动、活动参与记录、系统通知、用户通知、签到记录

7. **系统管理体系（3张表）**
   - 系统配置、管理员账户、操作日志

### **设计特点**

- ✔ 雪花ID作为主键，支持分布式部署
- ✔ 毫秒级时间戳记录，精确到毫秒
- ✔ JSON字段存储灵活配置，易于扩展
- ✔ 完善的索引策略，支持高并发查询
- ✔ 外键约束和级联删除，保证数据一致性
- ✔ 软删除设计，重要数据可追溯
- ✔ 审计日志完整，操作可回溯
- ✔ 多语言支持，适配菲律宾市场

### 🎯 **适用场景**

- 抽奖电商平台
- 社交电商系统
- 游戏化营销平台
- 会员积分商城

---

> **文档版本：** v1.0
> **最后更新：** 2025-01-21
> **数据库版本：** MySQL 8.0+
> **字符集：** utf8mb4_unicode_ci
> **总表数：** 33张
