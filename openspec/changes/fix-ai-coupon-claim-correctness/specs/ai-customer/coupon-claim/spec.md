# Spec Delta — ai-customer/coupon-claim

## ADDED Requirements

### Requirement: 券序号 MUST 绑定最近展示的列表

当用户用序号指代券（如「领取1」「领第 1 张」「claim 1」）时，系统 MUST 按**最近一次向用户展示的券列表**解析该序号，MUST NOT 改用另一张列表（例如从「我的券」切到「可领取」）来解析。

为避免歧义：

- 同一轮对话中，系统 SHOULD 只展示一个带编号的券列表。
- 同时展示「可领取」与「已持有」时，编号 MUST 只属于可领取分区；已持有券 MUST 不带编号，或明确标注「不可领取」。
- 需要从一个列表切换到另一个列表时，系统 MUST 重新展示新列表，并请用户重新选择。

#### Scenario: 持有列表与可领取列表混用（实测缺陷）

- **WHEN** 用户刚看到「我的券」列表：1. Fixture（已达限领）、2. Big Spender（已过期）
- **AND** 用户说「帮我领取1」
- **THEN** 系统 MUST NOT 为 Fixture 或 Big Spender 创建领券卡
- **AND** 系统 MUST 说明 Fixture 已持有/已达限领，并说明当前没有可领取的券

#### Scenario: 可领取列表为空

- **WHEN** 最近展示的可领取列表为空
- **AND** 用户说「领取1」
- **THEN** 系统 MUST 回复当前没有可领取的券
- **AND** MUST NOT 创建确认卡或动作记录

#### Scenario: 可领取列表只有一张

- **WHEN** 最近展示的可领取列表只有一张有效券
- **AND** 用户说「领取1」
- **THEN** 确认卡 MUST 对应这张券
- **AND** 卡片展示的券名 MUST 与列表第 1 项一致

#### Scenario: 序号越界

- **WHEN** 用户说的序号超出最近展示列表的范围
- **THEN** 系统 MUST 说明列表里只有哪些券，并请用户重新选择
- **AND** MUST NOT 猜测或替换成另一张券

---

### Requirement: 领券确认卡 MUST 只为可领取项创建

创建 `claim_coupon` 确认卡前，系统 SHALL 用服务端可领取结果校验 `couponId`：

- 券 MUST 存在于当前可领取结果（有效 + `canClaim=true`）
- 校验失败时 MUST NOT 创建卡片、MUST NOT 写 `CONFIRM_CREATED` 动作
- 拒绝话术 MUST 说明真实原因（已过期 / 已下架 / 已抢光 / 已达限领），MUST NOT 笼统说「没有找到这张券」

#### Scenario: 过期券不再发卡

- **WHEN** 模型提交的 `couponId` 指向已过期模板
- **THEN** 服务端 MUST 拒绝创建卡片
- **AND** 用户 MUST 收到「已过期 / 不可领取」的可读提示
- **AND** `ai_action_requests` MUST NOT 出现该券的 `CONFIRM_CREATED`

#### Scenario: 有效券正常发卡

- **WHEN** `couponId` 在可领取结果中且 `canClaim=true`
- **THEN** 系统 SHALL 创建卡片与 `CONFIRM_CREATED` 动作
- **AND** 卡片展示的券名/参数 MUST 来源于服务端数据，而不是模型自由文本

---

### Requirement: 领券错误 MUST 对用户可读且本地化

AI 动作执行失败时，已知的领券错误 MUST 映射为中文可读结果，MUST NOT 把服务层英文错误原样发给用户。

最低覆盖：

- `This coupon has expired` → 这张券已过期
- `You have reached the maximum claim limit` → 你已达到这张券的领取上限
- `This coupon has been fully claimed` → 这张券已经被领完
- `Coupon is not available or inactive` → 这张券已下架或不可领取

#### Scenario: 执行时券刚好过期

- **WHEN** 用户确认时券已过期
- **THEN** 用户 MUST 收到中文的「已过期」提示
- **AND** 动作记录 MUST 置 `FAILED`
- **AND** 库存与用户券 MUST 不发生变化

---

### Requirement: 领券链路 MUST 可观测

每次领券尝试 SHALL 在 trace/动作记录中可区分：

- 卡片创建成功 → `CONFIRM`
- 守卫拒绝、未创建卡片 → `CONFIRM_REJECTED`
- 执行成功/失败 → `ai_action_requests.status = EXECUTED / FAILED`

#### Scenario: 守卫拒绝

- **WHEN** 领券卡因过期/限领/抢光被守卫拒绝
- **THEN** trace 状态 MUST 为 `CONFIRM_REJECTED`
- **AND** MUST NOT 出现 `CONFIRM_CREATED` 动作记录
