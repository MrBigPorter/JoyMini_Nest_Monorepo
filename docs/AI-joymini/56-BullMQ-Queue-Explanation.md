# BullMQ 队列原理解释

> 用餐厅厨房的类比，通俗理解 BullMQ 队列。

## 一句话

BullMQ = **Redis 做白板 + 生产者贴任务 + 消费者撕任务去做，做完自动销毁。**

## 生活类比：餐厅出餐

```
┌──────────────────────────────────────────────────────────┐
│                     🏪 餐厅                                 │
│                                                            │
│  前台（Producer）                   厨房（Consumer）         │
│  ┌──────────┐                     ┌──────────┐            │
│  │ 服务员 A  │                     │ 厨师 1   │            │
│  ├──────────┤                     ├──────────┤            │
│  │ 服务员 B  │                     │ 厨师 2   │            │
│  └──────────┘                     └──────────┘            │
│       │                                ↑                   │
│       │ 贴订单                          │ 撕订单            │
│       ▼                                │                   │
│  ┌─────────────────────────────────────┐                   │
│  │   📋 出餐口白板（Redis）              │                   │
│  │                                     │                   │
│  │  订单 1: 鱼香肉丝 ← 厨师 1 正在做     │                   │
│  │  订单 2: 宫保鸡丁 ← 厨师 2 正在做     │                   │
│  │  订单 3: 麻婆豆腐 ← 等待中            │                   │
│  │  订单 4: 回锅肉   ← 等待中            │                   │
│  │  ...                                │                   │
│  └─────────────────────────────────────┘                   │
│       ↑                                                    │
│   所有人都能看到这块白板                                     │
│   - 前台贴单时能看到还剩多少单在等                            │
│   - 厨师做完一个就去白板上撕下一个                            │
│   - 经理（监控）也能看到当前排队情况                          │
└──────────────────────────────────────────────────────────┘
```

## 核心概念

| 概念 | 厨房类比 | 技术对应 |
|------|---------|---------|
| **Queue（队列）** | 出餐口白板 | Redis 里的一个 List |
| **Producer（生产者）** | 服务员贴单 | 调用 `queue.add()` 的代码 |
| **Worker/Processor（消费者）** | 厨师撕单去做 | 实现 `process()` 方法的代码 |
| **Job（任务）** | 一张订单 | `{ id, data, attempts, ... }` |
| **Concurrency（并发数）** | 几个厨师同时做菜 | 同时处理几个 job |
| **Redis** | 白板（所有人都能看到） | 内存数据库，存队列数据 |

## 为什么用 Redis 而不是内存数组？

```
内存数组（手写队列）：
  服务员 A 的白板： [A, B, C]     ← 服务员 A 记在自己的小本本上
  服务员 B 看不到                   ← 信息不共享
  服务员 A 下班（进程重启）          ← 白板被扔掉，订单丢失 ❌

Redis（BullMQ）：
  墙上大白板：       [A, B, C, D, E]  ← 所有人都能看到
  服务员 A 下班                       ← 白板还在墙上
  服务员 B 接班                       ← 继续处理
  餐厅关门（重启）                    ← 白板收起来，明天还能用 ✅
```

## 完整流程

### 之前（没有队列）：服务员等厨师

```
管理后台保存 30 条例句
  → 调用 generateEmbedding("退款政策")
  → 站在厨房门口等厨师做（5 秒）
  → 厨师做完，服务员拿到结果
  → 再调用 generateEmbedding("退货规则")
  → 又站在厨房门口等（5 秒）
  → ... 30 次 ...
  → 服务员在厨房站了 150 秒 ❌
  → 后面顾客（其他 API 请求）没人管了
```

### 之后（有 BullMQ）：服务员先把单子贴窗口

```
管理后台保存 30 条例句
  → queue.add('embed', { text: "退款政策" })  ← 贴单，1ms
  → queue.add('embed', { text: "退货规则" })   ← 贴单，1ms
  → queue.add('embed', { text: "运费多少" })    ← 贴单，1ms
  → ... 30 次 ...
  → 30ms 全部贴完 ✅
  → 服务员立刻回去接待下一个顾客（API 返回 200）

  厨房窗口（Redis）上贴着 30 张单：
    ┌────┬────┬────┬────┬────┬────┐
    │退款│退货│运费│VIP │KYC │... │
    │政策│规则│多少│权益│流程│    │
    └────┴────┴────┴────┴────┴────┘

  厨师（Worker concurrency: 2）：
    不用问，窗口上就有单
    做完一个，转身撕下一个
    不慌不忙，75 分钟全部做完 ✅
```

## 数据在 Redis 里的生命周期

```
queue.add()  →  数据写入 Redis  →  Worker 处理  →  process() 返回  →  自动删除
   │                │                  │                │               │
   │                ▼                  ▼                ▼               ▼
   │           ┌──────────┐      ┌──────────┐     ┌──────────┐    ┌──────────┐
   │           │ wait 列表 │      │ active   │     │ 处理完成  │    │  已删除  │
   │           │ [job1,   │      │ [job1]   │     │ return   │    │  🗑️     │
   └──────────→│  job2,   │─────→│          │────→│ 结果     │───→│          │
               │  ...]    │      │          │     │          │    │          │
               └──────────┘      └──────────┘     └──────────┘    └──────────┘

API 返回 200 是在这里 👆
（数据还在 Redis 里，还没处理）
```

**关键：API 返回 200 只表示"数据成功写入 Redis"，不代表"数据处理完了"。**
Worker 处理完并 return 结果后，BullMQ 自动从 Redis 删除该 job。

## 极简代码例子

### 只需要 3 个部分

#### 1. 注册队列（告诉 NestJS 有个叫 "kitchen" 的出餐口）

```typescript
BullModule.registerQueue({ name: 'kitchen' })
```

#### 2. 生产者（服务员贴单）

```typescript
@InjectQueue('kitchen') private queue: Queue
await this.queue.add('cook', { dish: '鱼香肉丝' })
// ↑ 贴单到 Redis，1ms 完成，API 可以立即返回 200
```

#### 3. 消费者（厨师做菜 + 自动销毁）

```typescript
@Processor('kitchen', { concurrency: 2 }) // 2 个厨师
async process(job: Job) {
  const result = await cook(job.data.dish); // 做菜
  return result; // ← return 后 BullMQ 自动从 Redis 删除这个 job 🗑️
}
```

### 完整运行效果

```
前台贴单：
  📋 前台贴单：鱼香肉丝    ← 1ms
  📋 前台贴单：宫保鸡丁    ← 1ms
  📋 前台贴单：麻婆豆腐    ← 1ms
  📋 前台贴单：回锅肉      ← 1ms
  📋 前台贴单：水煮鱼      ← 1ms
  ✅ 前台贴完 5 张单，可以去接待其他客人了
  ↑ 总共 5ms，API 返回 200

厨房做菜（concurrency: 2，同时做 2 个）：
  👨‍🍳 厨师 1 开始做：鱼香肉丝    ← 0s
  👨‍🍳 厨师 2 开始做：宫保鸡丁    ← 0s
  （等待 5 秒...）
  ✅ 厨师 1 做完：鱼香肉丝        ← 5s  → 自动销毁单子 🗑️
  👨‍🍳 厨师 1 开始做：麻婆豆腐    ← 5s  → 拿下一张
  ✅ 厨师 2 做完：宫保鸡丁        ← 5s  → 自动销毁单子 🗑️
  👨‍🍳 厨师 2 开始做：回锅肉      ← 5s  → 拿下一张
  （等待 5 秒...）
  ✅ 厨师 1 做完：麻婆豆腐        ← 10s → 自动销毁单子 🗑️
  👨‍🍳 厨师 1 开始做：水煮鱼      ← 10s → 拿下一张
  ✅ 厨师 2 做完：回锅肉          ← 10s → 自动销毁单子 🗑️
  （等待 5 秒...）
  ✅ 厨师 1 做完：水煮鱼          ← 15s → 自动销毁单子 🗑️

总耗时：前台 5ms + 厨房 15s = 15s
如果没有队列：前台要等 5×5s = 25s，而且期间不能做其他事
```

## 为什么用 BullMQ 而不是手写队列？

| 特性 | 手写内存队列 | BullMQ（Redis） |
|------|------------|----------------|
| **进程重启** | 队列丢失，任务没了 | Redis 持久化，重启后继续做 |
| **失败重试** | 要自己写 | 内置 `attempts: 3, backoff: 'exponential'` |
| **监控** | 看不到 | 管理后台有队列监控页面 |
| **多实例** | 每个进程各排各的 | 多个 API 实例共享同一个 Redis 队列 |
| **并发控制** | 要自己写 | `concurrency: 2` 一行搞定 |

## Redis 的角色

**Redis = 出餐口的那块白板/订单架。**

```
前台（Producer）做的事：
  queue.add({ text: "退款政策" })
  本质：往 Redis 写了一条数据
  → Redis.LPUSH('bull:embedding:wait', jobData)

Redis（共享存储）：
  存的是：["退款政策", "退货规则", "运费多少", ...]
  不是"显示给用户看"，而是"程序运行时真正读写的数据库"

厨房（Consumer）做的事：
  process(job) → job.data.text = "退款政策"
  本质：从 Redis 读了一条数据，处理完再写结果回 Redis
  → Redis.RPOP('bull:embedding:wait')
  → process() return → Redis.DEL('bull:embedding:job:1')

监控页面（可选）：
  从 Redis 读取统计数据展示给管理员
  只读不写，可有可无
```

## 项目中的现有队列

项目已经重度使用 BullMQ，有以下现有队列：

| 队列名 | 用途 | 文件 |
|--------|------|------|
| `blog-ai` | AI 文章处理 | [`blog-ai.processor.ts`](../../apps/api/src/blog/processors/blog-ai.processor.ts) |
| `avatar` | 头像处理 | [`avatar.processor.ts`](../../apps/api/src/common/avatar/avatar.processor.ts) |
| `group_settlement` | 团购结算 | [`group.processor.ts`](../../apps/api/src/common/group/processors/group.processor.ts) |
| `MEDIA_PROCESSOR_QUEUE` | 媒体处理 | [`media.processor.ts`](../../apps/api/src/common/media/media.processor.ts) |

## 常见问题

### Q: API 返回 200 后 Redis 数据会立即删除吗？

不会。API 返回 200 只表示"数据成功写入 Redis"，Worker 处理完并 return 后 BullMQ 才自动删除。

### Q: 如果进程重启，Redis 里的数据会丢吗？

不会。Redis 是独立服务，API 重启不影响 Redis 里的数据。Worker 重启后会继续处理未完成的任务。

### Q: 多个 Worker 会抢同一个任务吗？

不会。Redis 的 `RPOP` 是原子操作，同一时刻只有一个 Worker 能拿到一个 job。

### Q: 任务失败了怎么办？

BullMQ 内置重试机制。配置 `attempts: 3` 后，失败的任务会自动重新入队，最多重试 3 次。
