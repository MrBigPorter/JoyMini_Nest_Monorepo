---
title: '博客安全体系：Like 去重守卫 + AC 自动机敏感词过滤'
slug: blog-security-like-dedup-sensitive-word
description: 博客 API 的两道安全防线：基于指纹 + Redis 的点赞去重守卫（LikeDeduplicationGuard）和基于 AC 自动机的敏感词过滤 Pipe，实现零侵入的安全集成。
tags:
  - NestJS
  - Security
  - Redis
  - Rate Limiting
  - Sensitive Word Filter
  - TypeScript
---

# 博客安全体系：Like 去重守卫 + AC 自动机敏感词过滤

> **源码参考**: [`like-deduplication.guard.ts`](apps/api/src/blog/guards/like-deduplication.guard.ts) (76 行) · [`sensitive-word-filter.pipe.ts`](apps/api/src/blog/pipes/sensitive-word-filter.pipe.ts) (201 行)

---

## 概述

博客系统需要同时处理 **用户交互安全性** 和 **内容合规性**。本体系包含两个核心组件：

| 组件 | 类型 | 职责 |
|------|------|------|
| `LikeDeduplicationGuard` | NestJS Guard | 防止点赞刷票（服务端指纹 + Redis TTL） |
| `SensitiveWordFilterPipe` | NestJS Pipe | 敏感词过滤（AC 自动机 + 三级分级） |

---

## 1. Like 去重守卫

### 1.1 问题

博客点赞场景中，用户可以通过以下方式刷票：
- 清除浏览器 Cookie/localStorage
- 切换 IP（VPN）
- 修改 User-Agent
- 直接调用 API

### 1.2 解决方案：服务端指纹

```typescript
@Injectable()
export class LikeDeduplicationGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const { slug } = request.params;
    const fingerprint = this.generateFingerprint(request, slug);

    // 检查 Redis 中是否存在该指纹
    const exists = await this.redisClient.exists(`blog:like:${fingerprint}`);

    if (exists) {
      throw new ForbiddenException('You have already liked this article');
    }

    // 写入 Redis，24 小时过期
    await this.redisClient.set(`blog:like:${fingerprint}`, '1', 'EX', 86400);

    // 注入指纹到请求体，供后续审计
    request.body = { ...request.body, _fingerprint: fingerprint };

    return true;
  }

  private generateFingerprint(request: Request, articleSlug: string): string {
    const ip = request.ip || request.socket?.remoteAddress || 'unknown';
    const ua = request.headers['user-agent'] || 'unknown';
    const salt = this.configService.get<string>('LIKE_FINGERPRINT_SALT');

    // MD5(IP + UserAgent + slug + salt)
    return createHash('md5')
      .update(`${ip}:${ua}:${articleSlug}:${salt}`)
      .digest('hex');
  }
}
```

### 1.3 指纹构成

```
fingerprint = MD5(IP + UserAgent + articleSlug + SALT)
```

**为什么包含 salt？**
- 防止攻击者猜到指纹生成算法
- 不同的 salt 值可以生成不同的指纹（开发/生产环境）

### 1.4 降级策略

```typescript
// Redis 不可用时，允许请求通过（不阻塞用户体验）
try {
  const exists = await this.redisClient.exists(`blog:like:${fingerprint}`);
  // ...
} catch (error) {
  // Redis 连接失败，灰度放行
  this.logger.warn('Redis unavailable, skipping like dedup');
  return true;
}
```

**优雅降级**: Redis 宕机时，守卫放行所有请求。这不是最优解（可能出现刷票），但保证了用户体验不被 Redis 故障影响。

---

## 2. 敏感词过滤 Pipe

### 2.1 算法选择：AC 自动机

AC 自动机（Aho-Corasick Automaton）是多模式字符串匹配的最优算法：

| 算法 | 时间复杂度 | 适用场景 |
|------|-----------|----------|
| 暴力匹配 | O(n × m × k) | ❌ n=文本长度, m=敏感词数, k=平均词长 |
| 正则 | O(n × m) | ❌ 每个敏感词一个正则 |
| **AC 自动机** | **O(n + m + z)** | ✅ n=文本长度, m=构建时间, z=匹配次数 |

AC 自动机在构建时预处理所有敏感词，形成类似 Trie 树 + fail 指针的结构，一次遍历即可找出所有匹配。

### 2.2 实现

```typescript
@Injectable()
export class SensitiveWordFilterPipe implements PipeTransform {
  private static ac: AhoCorasick;          // 静态 AC 自动机实例
  private static wordMap: Map<string, SensitiveWordLevel>;  // 分级映射
  private static lastUpdate: number;        // 最后更新时间

  constructor() {
    this.initializeWordLibrary();
  }
```

**静态字段**: `ac` 和 `wordMap` 声明为 `static`，确保所有请求共享同一个 AC 自动机实例，避免重复构建。

### 2.3 三级敏感词

```typescript
export enum SensitiveWordLevel {
  LOW = 1,     // 轻微 - 自动替换为 ***
  MEDIUM = 2,  // 中等 - 标记进入审核队列
  HIGH = 3,    // 严重 - 直接拦截
}
```

### 2.4 递归过滤

```typescript
transform(value: any, metadata: ArgumentMetadata) {
  return this.filterValue(value);
}

private filterValue(value: any): any {
  if (typeof value === 'string') {
    return this.filterText(value);         // 字符串直接过滤
  }

  if (Array.isArray(value)) {
    return value.map((item) => this.filterValue(item));  // 数组递归
  }

  if (value !== null && typeof value === 'object') {
    const filtered: Record<string, any> = {};
    for (const key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        filtered[key] = this.filterValue(value[key]);  // 对象递归
      }
    }
    return filtered;
  }

  return value;  // 其他类型原样返回
}
```

**递归处理**: Pipe 递归遍历 DTO 的所有字段（包括嵌套对象和数组），确保没有遗漏。

### 2.5 分级处理逻辑

```typescript
private filterText(text: string): string {
  const matches = this.searchSensitiveWords(text);

  if (matches.length === 0) return text;

  // 1. 高等级 -> 直接拦截
  const hasHighLevel = matches.some(m => m.level === SensitiveWordLevel.HIGH);
  if (hasHighLevel) {
    throw new HttpException('内容包含违规信息，无法发布', HttpStatus.BAD_REQUEST);
  }

  // 2. 中等级 -> 标记审核
  const hasMediumLevel = matches.some(m => m.level === SensitiveWordLevel.MEDIUM);
  if (hasMediumLevel) {
    // 设置请求标记，Controller/Service 可以读取
  }

  // 3. 低等级 -> 自动替换
  return this.replaceSensitiveWords(text, matches);
}
```

### 2.6 替换算法

```typescript
private replaceSensitiveWords(text: string, matches: SensitiveWordMatch[]): string {
  // 按起始位置排序
  matches.sort((a, b) => a.start - b.start);

  let result = '';
  let lastIndex = 0;

  for (const match of matches) {
    if (match.start >= lastIndex) {
      result += text.substring(lastIndex, match.start);  // 保留未匹配部分
      result += '*'.repeat(match.word.length);           // 替换为等长星号
      lastIndex = match.end + 1;                         // 移动指针
    }
  }

  // 追加剩余文本
  if (lastIndex < text.length) {
    result += text.substring(lastIndex);
  }

  return result;
}
```

**等长替换**: 每个敏感词被替换为等长的 `*`，保持文本整体长度和布局不变。

### 2.7 搜索实现

```typescript
private searchSensitiveWords(text: string): SensitiveWordMatch[] {
  const lowerText = text.toLowerCase();
  const results = SensitiveWordFilterPipe.ac.search(lowerText);
  const matches: SensitiveWordMatch[] = [];

  for (const result of results) {
    const endIndex = result[0];          // 匹配结束位置
    const words = result[1];             // 匹配到的敏感词数组

    for (const word of words) {
      const startIndex = endIndex - word.length + 1;
      const level = SensitiveWordFilterPipe.wordMap.get(word.toLowerCase())
        || SensitiveWordLevel.LOW;

      matches.push({ word, level, start: startIndex, end: endIndex });
    }
  }

  return matches;
}
```

---

## 3. 对比：Guard vs Pipe

| 维度 | LikeDeduplicationGuard | SensitiveWordFilterPipe |
|------|----------------------|------------------------|
| **类型** | Guard（守卫） | Pipe（管道） |
| **执行时机** | 进入 Controller 之前 | Controller 参数解析时 |
| **失败结果** | `403 Forbidden` | `400 Bad Request` |
| **外部依赖** | Redis | 无（纯内存 AC 自动机） |
| **性能** | O(1) Redis 查询 | O(n) AC 自动机扫描 |
| **状态** | 有状态（Redis 写） | 无状态 |
| **适用范围** | 点赞接口 | 评论/文章发布接口 |

---

## 4. 生产配置建议

### 4.1 敏感词库管理

```typescript
private initializeWordLibrary() {
  // 内置基础敏感词库
  const sensitiveWords = [
    // 🔴 严重违禁词
    { word: 'term1', level: SensitiveWordLevel.HIGH },
    { word: 'term2', level: SensitiveWordLevel.HIGH },

    // 🟠 中等广告/垃圾词
    { word: 'add_wechat', level: SensitiveWordLevel.MEDIUM },
    { word: 'contact_phone', level: SensitiveWordLevel.MEDIUM },

    // 🟡 轻微不文明用语
    { word: 'badword1', level: SensitiveWordLevel.LOW },
    { word: 'badword2', level: SensitiveWordLevel.LOW },
  ];
  // 构建 AC 自动机
}
```

**生产建议**:
- 将敏感词库迁移到数据库或配置文件，支持热更新
- 实现 `refreshWordLibrary()` 方法，定时从数据库加载最新词库
- 通过 `lastUpdate` 时间戳判断是否需要重新构建 AC 自动机

### 4.2 Like 去重优化

- `EX 86400` — 24 小时过期，用户每天可点赞一次
- 可配置化：支持不同文章类型设置不同冷却时间（如博客 24h，评论 1h）
- 批量去重：使用 Redis Pipeline 批量检查多个文章的点赞状态

---

## 总结

这个安全体系展示了 NestJS 中两个不同层级的防御策略：

1. **LikeDeduplicationGuard** (Guard 层):
   - 服务端指纹（IP + UA + Salt + Slug）→ MD5
   - Redis 24h TTL 防重复
   - Redis 故障时优雅降级

2. **SensitiveWordFilterPipe** (Pipe 层):
   - AC 自动机多模式匹配，O(n) 时间复杂度
   - 三级分级处理（拦截/审核/替换）
   - 递归遍历 DTO 所有字段
   - 等长 `*` 替换保持文本布局

这种 **Guard 负责外防（刷票） + Pipe 负责内审（内容合规）** 的分层设计是 NestJS 中推荐的安全实践。
