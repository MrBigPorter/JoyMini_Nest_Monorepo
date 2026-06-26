# 12. 政策知识文档 + RAG Stub（知识库基础）

## 🎯 本步骤目标

1. 创建 `knowledge/` 目录下的 8 个政策知识 Markdown 文档
2. 更新 `graph/nodes/rag.node.ts` — 实现基础的政策文档加载和关键词匹配查询
3. 建立知识库目录结构，为 Phase 3（文档 13 + 17）的 pgvector 向量搜索做准备

完成本步骤后，RAG 节点可以基于静态 Markdown 文件回答"怎么退货"、"发货多久"等政策类问题。

---

## 📖 开发背景

### 承上：上一步做了什么？

[11-LuckyDrawFlashAgent与Tools.md](11-LuckyDrawFlashAgent与Tools.md) 完成了：
- `graph/tools/lucky-tools.ts` — 5 个抽奖/闪购工具的工厂函数
- `graph/nodes/lucky-agent.node.ts` — Lucky ReAct Agent
- **Phase 2（6 个 ReAct Agent）全部完成**

### 启下：下一步做什么？

下一步 [13-PrismaKnowledge模型与pgvector.md](13-PrismaKnowledge模型与pgvector.md) 将：
- 定义 KnowledgeDocument + KnowledgeEmbedding 的 Prisma 模型
- 配置 pgvector 扩展
- 创建数据导入脚本

本步骤的 Phase 1 Stub 将在文档 17 中被完整的向量搜索替代。

### RAG 架构演进

```
Phase 1（本步骤）         Phase 3（文档 17）
┌─────────────────┐      ┌─────────────────────────┐
│ 静态 Markdown 文件  │      │  pgvector 向量数据库       │
│ 关键词匹配查询      │ ──►  │  mxbai-embed-large 嵌入   │
│ 适用于 MVP 快速实现  │      │  语义搜索 + 混合检索       │
└─────────────────┘      └─────────────────────────┘
```

---

## 🔧 前提条件

- [x] 11 文档已完成（Phase 2 全部 Agent）
- [x] `knowledge/` 目录已创建（`apps/api/src/client/ai-customer/knowledge/`）

---

## ⚙️ 实现步骤

### Step 1: 创建 8 个政策知识文档

所有文档放在 `apps/api/src/client/ai-customer/knowledge/` 目录下。

#### 文件 1: `refund-policy.md` — 退货/退款政策

```markdown
# 退货与退款政策

## 退货条件
- 商品签收后 7 天内可申请无理由退货
- 商品需保持原状（未拆封、未使用、配件齐全）
- 特殊商品（内衣、食品等）不支持无理由退货

## 退款流程
1. 在订单页面提交退款申请
2. 上传商品照片（如有质量问题）
3. 商家 48 小时内审核
4. 审核通过后，退款原路返回（3-5 个工作日）

## 退款金额
- 无理由退货：退还商品金额（不包含运费）
- 质量问题退货：退还商品金额 + 退货运费
- 部分退款：按实际退货商品比例计算

## 时效说明
- 审核时效：48 小时
- 退款到账：3-5 个工作日
- 退货物流：用户需在审核通过后 3 天内寄出
```

#### 文件 2: `shipping-policy.md` — 发货/物流政策

```markdown
# 发货与物流政策

## 发货时效
- 现货商品：下单后 24 小时内发货
- 预售商品：按商品页面标注的发货时间
- 定制商品：7-15 个工作日

## 运费说明
- 满 $50 包邮（部分地区除外）
- 不满 $50 收取运费 $5
- 偏远地区（如 Hawaii、Alaska）需补运费差价

## 物流追踪
- 发货后系统会自动发送物流单号
- 支持查询：UPS、FedEx、USPS
- 国际订单：7-15 个工作日送达

## 注意事项
- 请确认收货地址准确无误
- 地址变更需在发货前修改
- 物流异常请联系客服
```

#### 文件 3: `coupon-rules.md` — 优惠券使用规则

```markdown
# 优惠券使用规则

## 优惠券类型
- 满减券：满指定金额减指定金额
- 折扣券：享受指定折扣比例
- 免邮券：免除运费

## 使用条件
- 每笔订单限用一张优惠券
- 优惠券不可与其他促销活动叠加
- 部分商品不参与优惠券活动

## 有效期
- 普通优惠券：领取后 7 天有效
- 活动优惠券：按活动页面标注有效期
- 过期优惠券不可恢复

## 退券规则
- 订单取消：优惠券退回（仍在有效期内）
- 部分退款：优惠券不退
- 全额退款：优惠券退回
```

#### 文件 4: `group-rules.md` — 拼团规则

```markdown
# 拼团规则

## 拼团机制
- 团长开团后邀请好友参团
- 规定时间内达到人数要求即为拼团成功
- 拼团成功后按团购价发货

## 时间限制
- 普通团：24 小时内需达成人数要求
- 闪电团：2 小时内需达成人数要求
- 超时未达成 = 拼团失败

## 拼团失败处理
- 系统自动退款（原路返回）
- 退款时效：1-3 个工作日
- 可重新开团

## 参团限制
- 每个用户对同一商品限参团一次
- 团长不可中途退出
- 团员可在成团前退出
```

#### 文件 5: `lucky-draw-rules.md` — 抽奖规则

```markdown
# 抽奖规则

## 抽奖资格
- 每笔订单满 $50 获得一张抽奖券
- 参与拼团成功额外获得一张抽奖券
- 活动期间可能有额外赠送

## 抽奖方式
- 使用抽奖券参与抽奖
- 每次消耗一张抽奖券
- 抽奖结果即时公布

## 奖品设置
- 一等奖：免单（全额返还）
- 二等奖：$50 优惠券
- 三等奖：$10 优惠券
- 参与奖：积分 100

## 奖品发放
- 优惠券：中奖后自动发放到账户
- 免单：以优惠券形式返还
- 实物奖品：7 个工作日内寄出

## 注意事项
- 抽奖券有效期 30 天
- 中奖概率以活动页面为准
- 禁止利用漏洞刷奖
```

#### 文件 6: `kyc-rules.md` — KYC 认证规则

```markdown
# KYC 认证规则

## 认证要求
- 单笔交易超过 $500 需完成 KYC
- 累计交易超过 $2000 需完成 KYC
- 提现金额超过 $100 需完成 KYC

## 认证方式
- 上传身份证/护照
- 面部识别验证
- 地址证明（可选）

## 认证流程
1. 提交身份证明文件
2. 系统自动审核（通常 5 分钟）
3. 审核通过后解锁额度

## 隐私保护
- 所有认证信息加密存储
- 仅用于合规审核
- 认证信息 30 天后自动删除
```

#### 文件 7: `vip-benefits.md` — VIP 会员权益

```markdown
# VIP 会员权益

## 会员等级
- 普通会员：注册即享
- 银卡会员：累计消费 $200
- 金卡会员：累计消费 $500
- 钻石会员：累计消费 $2000

## 权益对比

| 权益 | 普通 | 银卡 | 金卡 | 钻石 |
|------|------|------|------|------|
| 运费减免 | - | 满$30包邮 | 包邮 | 包邮 |
| 折扣 | - | 9.8折 | 9.5折 | 9折 |
| 积分倍率 | 1x | 1.2x | 1.5x | 2x |
| 专属客服 | - | - | ✅ | ✅ |
| 生日礼包 | - | - | - | ✅ |

## 升降级规则
- 升级：累计消费达标后自动升级
- 保级：每年消费达等级要求的 50%
- 降级：保级失败则降一级
```

#### 文件 8: `privacy-policy.md` — 隐私政策

```markdown
# 隐私政策

## 收集的信息
- 注册信息：邮箱、手机号
- 订单信息：收货地址、联系方式
- 设备信息：IP 地址、浏览器类型

## 信息用途
- 处理订单和配送
- 发送订单通知
- 改善服务质量
- 合规要求（KYC）

## 信息保护
- 使用 SSL/TLS 加密传输
- 敏感信息加密存储
- 定期安全审计

## 用户权利
- 查阅个人信息
- 更正错误信息
- 删除账户（需联系客服）
- 导出个人数据

## Cookie 政策
- 必要 Cookie：维持登录状态
- 功能 Cookie：记住偏好设置
- 分析 Cookie：改善用户体验
```

### Step 2: 更新 RAG Node — 基础查询实现

**文件**: `apps/api/src/client/ai-customer/graph/nodes/rag.node.ts`

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { AgentStateType } from '../state';

/**
 * RAG Node — Phase 1 静态政策文档查询
 *
 * 实现方式：
 * 1. 初始化时加载所有 knowledge/*.md 文件到内存
 * 2. 查询时做简单的关键词匹配（分词 + 权重评分）
 * 3. 返回最匹配的文档内容
 *
 * Phase 3（文档 17）将替换为完整的 pgvector 向量搜索。
 */
export class RagNode {
  private documents: Array<{ title: string; content: string }> = [];
  private initialized = false;

  /**
   * 加载知识文档
   */
  async initialize() {
    if (this.initialized) return;

    const knowledgeDir = path.join(__dirname, '../../knowledge');

    if (!fs.existsSync(knowledgeDir)) {
      console.warn('[RAG] Knowledge directory not found:', knowledgeDir);
      this.initialized = true;
      return;
    }

    const files = fs
      .readdirSync(knowledgeDir)
      .filter((f) => f.endsWith('.md'))
      .sort();

    for (const file of files) {
      const content = fs.readFileSync(path.join(knowledgeDir, file), 'utf-8');
      const title = file.replace(/\.md$/, '');
      this.documents.push({ title, content });
    }

    console.log(`[RAG] Loaded ${this.documents.length} knowledge documents`);
    this.initialized = true;
  }

  /**
   * 简单关键词匹配搜索
   *
   * 对用户输入分词，计算每个文档的匹配得分，
   * 返回得分最高的文档内容。
   */
  private search(query: string): string {
    if (this.documents.length === 0) {
      return '暂无相关知识文档。';
    }

    // 简单分词：按常见分隔符拆分
    const keywords = query
      .toLowerCase()
      .split(/[\s,，。.！？、；;：:\n\r]+/)
      .filter((k) => k.length > 1);

    if (keywords.length === 0) {
      return this.documents
        .map((d) => `--- ${d.title} ---\n${d.content}`)
        .join('\n\n');
    }

    // 计算每个文档的匹配得分
    const scores = this.documents.map((doc) => {
      const lowerContent = doc.content.toLowerCase();
      const lowerTitle = doc.title.toLowerCase();

      let score = 0;
      for (const kw of keywords) {
        // 标题匹配权重更高
        if (lowerTitle.includes(kw)) score += 5;
        // 内容匹配
        const matches = (lowerContent.match(new RegExp(kw, 'g')) || []).length;
        score += matches;
      }

      return { doc, score };
    });

    // 按得分降序排列，取最高分的文档
    scores.sort((a, b) => b.score - a.score);

    if (scores[0].score === 0) {
      return '未找到匹配的政策信息，请咨询人工客服。';
    }

    const best = scores[0];
    return `根据【${best.doc.title}】的相关规定：\n\n${best.doc.content}`;
  }

  /**
   * 执行 RAG 查询
   */
  async query(userInput: string): Promise<string> {
    await this.initialize();
    return this.search(userInput);
  }
}

// 全局单例
const ragNodeInstance = new RagNode();

/**
 * RAG Node 函数（供 LangGraph 调用）
 */
export const ragNode = async (
  state: typeof AgentState.State,
): Promise<Partial<typeof AgentState.State>> => {
  const lastMessage = state.messages[state.messages.length - 1];
  const userInput =
    typeof lastMessage?.content === 'string'
      ? lastMessage.content
      : JSON.stringify(lastMessage?.content ?? '');

  try {
    const result = await ragNodeInstance.query(userInput);
    return {
      agentOutput: result,
    };
  } catch (error: any) {
    return {
      agentOutput: `知识查询出错：${error.message}`,
    };
  }
};
```

### Step 3: 理解 Phase 1 RAG 的局限性

| 方面 | Phase 1（本步骤） | Phase 3（文档 17） |
|------|-------------------|-------------------|
| 数据源 | 静态 .md 文件 | pgvector 向量数据库 |
| 检索方式 | 关键词匹配（简单分词） | 语义搜索（mxbai-embed-large） |
| 准确率 | 依赖关键词覆盖 | 理解语义相似度 |
| 维护性 | 手动编辑 .md 文件 | 后台自动同步 |
| 扩展性 | 仅支持 8 个文档 | 支持任意数量文档 |
| 多语言 | 仅中文 | 多语言嵌入向量 |

---

## ✅ 验证

```bash
# 检查知识文档是否创建
ls -la apps/api/src/client/ai-customer/knowledge/
# 预期输出：
# refund-policy.md
# shipping-policy.md
# coupon-rules.md
# group-rules.md
# lucky-draw-rules.md
# kyc-rules.md
# vip-benefits.md
# privacy-policy.md

# 编译检查
yarn workspace @lucky/api build
```

---

## 📝 技术要点

### 文档命名规范

知识文档使用 `kebab-case` 命名，文件名对应政策主题：

| 文件名 | 对应政策 | 客服用途 |
|--------|---------|---------|
| `refund-policy.md` | 退款政策 | 回答退货/退款问题 |
| `shipping-policy.md` | 物流政策 | 回答发货/运费问题 |
| `coupon-rules.md` | 优惠券规则 | 回答优惠券使用问题 |
| `group-rules.md` | 拼团规则 | 回答拼团相关问题 |
| `lucky-draw-rules.md` | 抽奖规则 | 回答抽奖相关问题 |
| `kyc-rules.md` | KYC 认证 | 回答认证相关问题 |
| `vip-benefits.md` | VIP 权益 | 回答会员相关问题 |
| `privacy-policy.md` | 隐私政策 | 回答隐私相关问题 |

### Phase 1 的关键词搜索策略

本步骤使用最简单的关键词匹配策略：

1. **分词**：按标点符号和空格拆分用户输入
2. **标题加权**：文档标题匹配权重 x5
3. **内容计数**：文档内容中关键词出现次数
4. **最佳匹配**：取最高分文档返回

### RAG Node 的单例模式

`RagNode` 使用单例模式，确保文档只在首次查询时加载一次。这种方式在 Phase 1 足够，Phase 3 切换到 pgvector 后不再需要。

---

## 🔜 下一步预告

在 [13-PrismaKnowledge模型与pgvector.md](13-PrismaKnowledge模型与pgvector.md) 中，我们将：
- 在 Prisma schema 中定义 `KnowledgeDocument` 和 `KnowledgeEmbedding` 模型
- 配置 pgvector 扩展（vector(768) 匹配 mxbai-embed-large）
- 创建数据导入脚本，将 .md 文件导入数据库
