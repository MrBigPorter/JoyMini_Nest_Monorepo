# 🎯 多模式适配层 - 使用指南

这是整个前端架构的核心地基。**所有业务代码必须通过这个层进行接口请求，不允许直接使用fetch或axios。**

## ✅ 设计原则

✅ **业务代码永远不需要知道运行在什么环境**
✅ 同一个API调用在 SSR / SSG / CSR 下自动选择最优实现
✅ 写操作接口自动在服务端跳过，不会有重复提交
✅ 缓存策略自动适配环境，不需要手动配置

## 📦 导出模块

```typescript
import { fetcher } from '@/lib/fetcher';
import { detectEnvironment, isServer, isClient } from '@/lib/env';
```

## 🚀 基础用法

### 只读接口 (自动支持所有环境)

```typescript
// 这段代码在SSR/SSG/CSR下都可以完美运行
const { data } = await fetcher.get<Article[]>('/articles', { ttl: 300 });
```

### 写操作接口 (仅客户端执行)

```typescript
// 在服务端会自动跳过，不会真正发送请求
const result = await fetcher.post('/articles/123/like', { like: true });
```

### 自定义请求

```typescript
const result = await fetcher.request('/custom-path', {
  method: 'POST',
  type: 'read', // 强制标记为只读接口，允许在服务端执行POST
  ttl: 60,
});
```

## 🔍 环境检测

```typescript
const env = detectEnvironment(); // 'ssr' | 'ssg' | 'csr'

if (isClient()) {
  // 仅在浏览器执行的代码
}

if (isServer()) {
  // 仅在服务端执行的代码
}
```

## 🎯 架构优势

1. **零心智负担**: 业务开发者只需要写一次代码
2. **性能最优**: 每个环境自动选择最快的请求路径
3. **安全可靠**: 写操作永远不会在服务端意外执行
4. **渐进式升级**: 未来替换成gRPC内部调用时，业务代码零修改

## ⚠️ 注意事项

❌ 不要在业务代码中写 `if (typeof window !== 'undefined')`
❌ 不要直接使用原生 `fetch` 或 axios
❌ 不要手动为不同环境写不同的实现

✅ 所有环境差异都应该在这个适配层解决
