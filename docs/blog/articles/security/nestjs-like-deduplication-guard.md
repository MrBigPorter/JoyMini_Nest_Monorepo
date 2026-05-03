---
title: 'NestJS 点赞去重：指纹 + Redis Guard 模式与分布式锁'
slug: nestjs-like-deduplication-guard
description: 博客系统的点赞接口通过指纹 + Redis Guard 模式实现防刷赞机制。涵盖指纹公式（MD5 哈希）、SET NX 原子操作、24 小时过期策略和 Redis 不可用时的优雅降级方案。
tags:
  - NestJS
  - Security
  - Performance
  - Redis
  - TypeScript
---

# NestJS 点赞去重：指纹 + Redis Guard 模式与分布式锁

> **Tags:** `NestJS`, `Security`, `Performance`, `Redis`, `TypeScript`

## 1. 背景：刷赞攻击

点赞接口是攻击者的最爱——因为它看起来"无害"，但实际上破坏力极强：

```bash
# 单脚本一秒钟可以刷出上千赞
for i in {1..1000}; do
  curl -X POST http://api/blog/articles/123/like
done
```

**问题等级**：中危 🟠

- ❌ 同一用户可以无限次点击点赞
- ❌ 可以通过脚本批量调用刷赞
- ❌ 文章点赞数完全失真不可信
- ❌ 没有任何防作弊机制

---

## 2. 技术方案

### 2.1 设计目标

- 同一用户 24 小时内只能点赞同一文章一次
- 高性能，响应时间 < 5ms
- 无需登录也能防重复
- 自动过期清理，无内存泄漏

### 2.2 方案对比

| 方案 | 安全性 | 性能 | 用户体验 | 实现复杂度 |
|------|--------|------|----------|-----------|
| **指纹 + Redis** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 低 |
| 数据库唯一约束 | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ | 低 |
| JWT Token 校验 | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | 中 |
| 设备指纹 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | 高 |

**最终选择**：指纹 + Redis，平衡安全、性能和实现成本。

---

## 3. 指纹识别算法

### 3.1 指纹公式

```
fingerprint = MD5( IP + UserAgent + ArticleId + Salt )
```

### 3.2 Redis 存储设计

```
Key:   blog:like:fingerprint:{hash}
TTL:   86400 秒 (24小时)
Value: 时间戳
```

### 3.3 完整流程

```
客户端请求 → 提取特征 (IP + UserAgent + ArticleId)
                    │
                    ▼
          MD5 哈希生成唯一指纹
                    │
                    ▼
         Redis 查询是否存在该指纹
                    │
              ┌─────┴─────┐
              │           │
            存在         不存在
              │           │
         返回 429    写入 Redis (24h 过期)
              │           │
              │      执行点赞数 +1
              │           │
              └─────┬─────┘
                    ▼
              返回成功
```

---

## 4. NestJS Guard 实现

将去重逻辑实现为 **Guard**，通过装饰器透明集成：

### 4.1 指纹 Guard

```typescript
@Injectable()
export class LikeDeduplicationGuard implements CanActivate {
  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const articleId = request.params.id;

    // 生成指纹
    const fingerprint = this.generateFingerprint(request, articleId);

    // 检查 Redis
    return this.checkFingerprint(fingerprint);
  }

  private generateFingerprint(request: any, articleId: string): string {
    const ip = request.ip;
    const ua = request.headers['user-agent'] || '';
    const salt = 'joymini-blog-like-2024';

    // MD5 哈希
    const hash = crypto
      .createHash('md5')
      .update(`${ip}${ua}${articleId}${salt}`)
      .digest('hex');

    return `blog:like:fingerprint:${hash}`;
  }

  private async checkFingerprint(key: string): Promise<boolean> {
    const exists = await this.cacheManager.get(key);

    if (exists) {
      throw new HttpException(
        '请不要重复点赞',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 写入 Redis，24 小时过期
    await this.cacheManager.set(key, Date.now().toString(), 86400);
    return true;
  }
}
```

### 4.2 集成到控制器

```typescript
@ApiTags('Blog - Articles')
@Controller('blog/articles')
export class ArticleController {
  @Post(':id/like')
  @UseGuards(LikeDeduplicationGuard)
  async likeArticle(@Param('id') id: string) {
    return this.articleService.incrementLike(id);
  }
}
```

---

## 5. 防绕过机制

| 措施 | 说明 |
|------|------|
| IP 地址 | 最基础识别 |
| UserAgent | 防止同一 IP 下多用户区分 |
| 盐值混淆 | 防止彩虹表反向破解 |
| 时间窗口 | 24 小时后可以再次点赞 |

---

## 6. 边缘优化

```typescript
// Redis 原子操作，无竞态条件
async checkFingerprint(key: string): Promise<boolean> {
  // 使用 SETNX 原子操作
  const result = await this.redis.set(key, Date.now().toString(), {
    NX: true,  // 不存在才写入
    EX: 86400, // 24小时过期
  });

  if (result === null) {
    // key 已存在，说明已点过赞
    throw new HttpException('请不要重复点赞', 429);
  }

  return true;
}
```

使用 `SET NX` 原子操作避免了竞态条件——即使并发请求同时到达，也只有一个能成功写入。

### 降级方案

当 Redis 不可用时，自动降级为无限制模式，不影响正常使用：

```typescript
private async checkFingerprint(key: string): Promise<boolean> {
  try {
    const result = await this.redis.set(key, Date.now().toString(), {
      NX: true,
      EX: 86400,
    });
    if (result === null) throw new HttpException('请不要重复点赞', 429);
    return true;
  } catch (error) {
    if (error instanceof HttpException) throw error;
    // Redis 不可用 → 降级为允许
    console.warn('Redis unavailable, like deduplication disabled');
    return true;
  }
}
```

---

## 7. 性能指标

| 指标 | 数值 |
|------|------|
| 单请求开销 | < 1ms |
| Redis QPS | > 10,000/秒 |
| 内存占用 | 每条记录 32 字节 |
| 百万级点赞 | 每天自动过期 |
| 降级切换 | < 100ms（Redis 超时检测） |

---

## 8. 前端二次校验

后端防不住"误触"——前端也需要配合：

```typescript
function LikeButton({ articleId }: { articleId: string }) {
  const [liked, setLiked] = useState(false);
  const [cooldown, setCooldown] = useState(false);

  const handleLike = async () => {
    if (cooldown) return; // 冷却中

    setCooldown(true);
    setTimeout(() => setCooldown(false), 3000); // 3秒冷却

    try {
      await likeArticle(articleId);
      setLiked(true);
    } catch (err) {
      if (err.status === 429) {
        toast('请勿重复点赞');
      }
    }
  };

  return (
    <button
      onClick={handleLike}
      disabled={cooldown || liked}
      className={liked ? 'text-blue-500' : 'text-gray-400'}
    >
      {liked ? '❤️ 已点赞' : '🤍 点赞'}
    </button>
  );
}
```

---

## 9. 测试场景

| 测试用例 | 预期结果 |
|----------|----------|
| 同一浏览器重复点赞 | 第二次返回 429 |
| 同一 IP 不同浏览器 | 可以分别点赞 |
| 24 小时后再次点赞 | 可以正常点赞 |
| 不同文章点赞 | 互相不受影响 |
| 脚本批量请求 | 全部拦截 |
| Redis 宕机 | 自动降级，可正常点赞 |

---

## 10. 后续优化

1. **设备指纹识别**：增加更多特征（屏幕分辨率、时区、字体列表）
2. **异常行为识别**：同一 IP 短时间大量点赞自动封禁
3. **点击流分析**：分析点赞行为模式，识别机器人
4. **冷却时间可配置**：不同文章类型使用不同冷却策略

---

## 11. 总结

点赞去重系统展示了 **Guard 模式** 在 NestJS 中的典型应用：

- **Guard 层**：用指纹 + Redis 实现去重，不污染业务逻辑
- **原子操作**：`SET NX` 避免竞态条件
- **优雅降级**：Redis 不可用时自动降级，不影响主业务
- **前端配合**：按钮冷却 + 后端 429，双重防护

核心经验：**不要相信客户端发来的任何请求**——即使是简单的点赞操作，也需要防刷机制。
