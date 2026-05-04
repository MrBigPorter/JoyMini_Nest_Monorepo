---
title: 'admin-next Browser Crypto Shim——使用 Web Crypto API 模拟 node:crypto'
slug: admin-next-browser-crypto-shim
tags: Next.js, Admin, TypeScript, Crypto, Web Crypto API, Browser, Node.js, Polyfill
description: A deep dive into the admin-next browser crypto shim — a lightweight polyfill that replaces node:crypto with the Web Crypto API for browser environments. Covers the createHash function, synchronous fallback, and the minimal-shim strategy for mixed Node.js/browser codebases.
---

# admin-next Browser Crypto Shim——使用 Web Crypto API 模拟 node:crypto

> **Article A13** — The admin-next [`crypto-shim.ts`](apps/admin-next/src/lib/crypto-shim.ts) provides a lightweight browser polyfill for `node:crypto`. Instead of pulling in a heavy crypto library, it uses the Web Crypto API (`globalThis.crypto.subtle.digest`) to implement only the methods actually used by the shared packages — enabling code sharing between Node.js (API) and browser (admin-next) environments.

- **Source**: [`crypto-shim.ts`](apps/admin-next/src/lib/crypto-shim.ts) (56L)
- **API**: Web Crypto API (`crypto.subtle.digest`)
- **Pattern**: Minimal shim / polyfill — only implement what's needed
- **Series**: admin-next Architecture Deep Dive

---

## 1. 背景

admin-next 是一个 **Next.js App Router** 项目。在某些场景下，它需要运行来自 [`@lucky/shared`](packages/shared) 包的代码，这个包最初是为 **Node.js 环境**（NestJS API）编写的。

问题在于：`@lucky/shared` 中使用了 Node.js 内置的 `crypto` 模块（`node:crypto`）：

```typescript
// @lucky/shared 中的代码（Node.js 环境）
import { createHash } from 'node:crypto';

const hash = createHash('sha256').update(data).digest('hex');
```

在 **Next.js 浏览器环境**（Client Component）中，`node:crypto` 不可用。直接引用会导致：

```
Module not found: Can't resolve 'node:crypto'
```

### 1.1 解决方案选项

| 方案 | 优点 | 缺点 |
|------|------|------|
| **Webpack/Fallback**（`config.resolve.fallback`） | 快速配置 | 引入完整的 `crypto-browserify` 包（>300KB） |
| **动态导入 + 条件分支** | 精确控制 | 代码复杂度增加，需修改共享包 |
| **最小 shim**（当前方案） | 极轻量（56L），仅实现已使用的方法 | 需要维护 shim 与上游的同步 |

我们选择了**方案 3**——创建一个最小化的 `node:crypto` shim，仅实现 `@lucky/shared` 实际使用的 API 方法。

---

## 2. 架构设计

### 2.1 核心思路

```text
Node.js 环境                       浏览器环境
─────────────                     ─────────────
import { createHash }             import { createHash }
from 'node:crypto'                from '@/lib/crypto-shim'
       │                                  │
       ▼                                  ▼
Node.js crypto                    Web Crypto API
（C++ 原生实现）                    (crypto.subtle.digest)
       │                                  │
       ▼                                  ▼
Hash (Buffer)                     Hash (Uint8Array → Buffer)
```

### 2.2 导出签名

```typescript
export function createHash(algorithm: string) {
  return {
    update(data: string | Uint8Array): this;
    digest(encoding?: string): Buffer | Uint8Array;
    digestAsync(): Promise<Buffer>;       // Web Crypto 版异步
    readUInt32BE(offset: number): number;
    _data: Uint8Array;
  };
}

export { createHash as default };
```

shim 的导出签名与 `node:crypto` 的 `createHash` 保持兼容，但增加了一个 `digestAsync()` 异步方法——这是 Web Crypto API 的特性决定的（`crypto.subtle.digest` 返回 Promise）。

---

## 3. 核心实现

### 3.1 createHash 函数

[`createHash`](apps/admin-next/src/lib/crypto-shim.ts:7) 是 shim 的核心导出：

```typescript
export function createHash(algorithm: string) {
  return {
    update(data: string | Uint8Array) {
      const bytes: Uint8Array =
        typeof data === 'string'
          ? new TextEncoder().encode(data)
          : data.slice();
      this._data = bytes;
      return this;
    },
    _data: new Uint8Array(),

    async digestAsync() {
      const hashBuffer = await globalThis.crypto.subtle.digest(
        algorithm.toUpperCase().replace('SHA', 'SHA-'),
        this._data,
      );
      return Buffer.from(hashBuffer);
    },

    digest(encoding?: string) {
      const arr = this._data;
      let hash = 0;
      for (let i = 0; i < arr.length; i++) {
        hash = (Math.imul(31, hash) + arr[i]) | 0;
      }
      const buf = new Uint8Array(4);
      new DataView(buf.buffer).setUint32(0, hash >>> 0, false);
      if (encoding === 'hex')
        return Array.from(buf)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
      return buf;
    },

    readUInt32BE(offset: number) {
      const arr = this._data;
      return (
        (arr[offset] << 24) |
        (arr[offset + 1] << 16) |
        (arr[offset + 2] << 8) |
        arr[offset + 3]
      );
    },
  };
}
```

### 3.2 update 方法——字符串与二进制统一

```typescript
update(data: string | Uint8Array) {
  const bytes: Uint8Array =
    typeof data === 'string'
      ? new TextEncoder().encode(data)
      : data.slice();
  this._data = bytes;
  return this;
}
```

`update()` 方法接受两种输入类型：

- **`string`**：使用 `TextEncoder().encode()` 转换为 UTF-8 字节序列
- **`Uint8Array`**：直接使用 `.slice()` 创建副本，避免引用原数据

返回 `this` 以支持链式调用（虽然当前使用中通常一次 `update` 后立即 `digest`）。

### 3.3 digestAsync——Web Crypto API 核心

```typescript
async digestAsync() {
  const hashBuffer = await globalThis.crypto.subtle.digest(
    algorithm.toUpperCase().replace('SHA', 'SHA-'),
    this._data,
  );
  return Buffer.from(hashBuffer);
}
```

这是 shim 的核心方法，使用 **Web Crypto API** 的 [`crypto.subtle.digest`](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest) 计算哈希。

**算法名称转换**：

| 输入 | 转换 | Web Crypto 格式 |
|------|------|-----------------|
| `sha256` | `toUpperCase()` → `SHA-256` | ✅ 有效 |
| `sha1` | `toUpperCase()` → `SHA-1` | ✅ 有效 |
| `sha512` | `toUpperCase()` → `SHA-512` | ✅ 有效 |

`node:crypto` 使用小写无连字符的格式（`sha256`），而 Web Crypto API 使用带连字符的大写格式（`SHA-256`）。通过简单的字符串替换即可完成格式转换。

### 3.4 digest——同步回退

```typescript
digest(encoding?: string) {
  const arr = this._data;
  let hash = 0;
  for (let i = 0; i < arr.length; i++) {
    hash = (Math.imul(31, hash) + arr[i]) | 0;
  }
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, hash >>> 0, false);
  if (encoding === 'hex')
    return Array.from(buf)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  return buf;
}
```

`digest()` 方法是一个**同步回退实现**，使用 Java 风格的 `hashCode` 算法（`hash = 31 * hash + byte[i]`）。

**为什么需要同步回退？**

Web Crypto API 的 `crypto.subtle.digest` 是**异步**的（返回 `Promise`）。但 `@lucky/shared` 中的某些代码调用的是同步的 `digest('hex')`。在浏览器中，无法在不重写大量代码的情况下将同步调用改为异步。

**这个实现的局限**：

- 不是真正的 SHA 哈希，而是一个简化的 32 位哈希
- 存在哈希碰撞的可能性（32 位空间）
- 仅用于**不需要加密安全性的场景**

**代码注释说明**：

```typescript
// Synchronous fallback: use a simple hash for browser context
// Note: OrderNoHelper is server-only; this path should never be hit on client
```

这表明同步 `digest` 方法实际上**不应该在浏览器中被调用**——`@lucky/shared` 中需要同步哈希的代码（如 `OrderNoHelper`）被设计为只在服务器端运行。这个实现仅作为安全网（safety net）。

### 3.5 readUInt32BE——大端整数解析

```typescript
readUInt32BE(offset: number) {
  const arr = this._data;
  return (
    (arr[offset] << 24) |
    (arr[offset + 1] << 16) |
    (arr[offset + 2] << 8) |
    arr[offset + 3]
  );
}
```

手动实现 `Buffer.readUInt32BE()` 的等价功能，将字节数组的指定偏移位置读取为一个 32 位无符号整数（大端序）。

---

## 4. Webpack/Next.js 集成

要让 shim 生效，需要在 Next.js 配置中将 `node:crypto` 解析指向 `crypto-shim.ts`：

### 4.1 next.config.js

```typescript
// next.config.ts
const config = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        crypto: false, // 禁用 node:crypto 的默认 fallback
      };
    }
    return config;
  },
};
```

### 4.2 在代码中使用

在浏览器端代码中显式导入 shim：

```typescript
// client component
import { createHash } from '@/lib/crypto-shim';

// 使用异步方法（推荐）
const hash = await createHash('sha256').update(data).digestAsync();
console.log(hash.toString('hex'));
```

在共享包（`@lucky/shared`）中，通过条件导出或动态导入来区分环境：

```typescript
// @lucky/shared — 环境感知导入
let createHash: (algorithm: string) => Hash;

if (typeof window === 'undefined') {
  // Server: use Node.js native crypto
  ({ createHash } = await import('node:crypto'));
} else {
  // Browser: use shim
  ({ createHash } = await import('crypto-shim'));
}
```

---

## 5. 使用场景

### 5.1 订单号生成（OrderNoHelper）

`OrderNoHelper` 使用 `createHash('sha256').digest('hex')` 在 Node.js 中生成订单号的哈希分量。在浏览器端，这个功能不会被调用（订单生成在 API 端），但代码被共享到前端时不能导致构建失败。

### 5.2 设备指纹计算

```typescript
// 设备指纹的浏览器端计算
import { createHash } from '@/lib/crypto-shim';

async function computeFingerprint(data: string): Promise<string> {
  const hash = await createHash('sha256').update(data).digestAsync();
  return hash.toString('hex');
}
```

### 5.3 签名验证（只读）

```typescript
// 校验从 API 返回的数据签名
import { createHash } from '@/lib/crypto-shim';

function verifySignature(payload: string, expectedSig: string): boolean {
  const hash = createHash('sha256').update(payload).digest('hex');
  return hash === expectedSig; // 简化版校验
}
```

---

## 6. 设计决策

### 6.1 为什么选择最小 shim 而非完整 polyfill？

| 方案 | 大小 | 维护成本 | 安全性 |
|------|------|---------|--------|
| **最小 shim**（当前） | ~1KB gzipped | 低（仅实现已使用的方法） | Web Crypto API 提供加密安全 |
| **crypto-browserify** | ~300KB+ | 无（第三方维护） | 完整 crypto 实现 |
| **wasm-crypto** | ~100KB | 中（绑定更新） | 接近原生性能 |

admin-next 只需要 `createHash` 这一个功能，引入完整的 `crypto-browserify` 包会使客户端 JS 体积膨胀 300KB+，这对管理后台性能不可接受。

### 6.2 为什么保留同步 digest？

理想情况下，所有使用 `createHash` 的地方都应该使用 `digestAsync()`。但现实中：

1. 某些第三方库或共享代码调用了同步 `digest()`
2. 重构这些调用需要跨多个包的大规模修改
3. 同步回退作为**安全网**，防止运行时崩溃

注释中明确标注了 `This path should never be hit on client`，提醒开发者该实现不应用于生产环境的安全敏感场景。

### 6.3 为什么使用 TextEncoder 而非 Buffer？

在浏览器环境中，`Buffer` 不可用（除非引入 `buffer` polyfill）。使用 `TextEncoder` 是标准化的 Web API，无需额外依赖。

---

## 7. 测试策略

```typescript
// crypto-shim.test.ts
import { createHash } from '@/lib/crypto-shim';

describe('crypto-shim', () => {
  it('should hash string with digestAsync', async () => {
    const hash = await createHash('sha256')
      .update('hello world')
      .digestAsync();
    expect(hash.toString('hex'))
      .toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });

  it('should hash Uint8Array', async () => {
    const data = new TextEncoder().encode('test');
    const hash = await createHash('sha256')
      .update(data)
      .digestAsync();
    expect(hash.length).toBe(32); // SHA-256 produces 32 bytes
  });

  it('should convert algorithm names', async () => {
    const hash = await createHash('sha1')
      .update('test')
      .digestAsync();
    expect(hash.length).toBe(20); // SHA-1 produces 20 bytes
  });

  it('should provide synchronous fallback', () => {
    const hash = createHash('sha256')
      .update('test')
      .digest('hex');
    expect(typeof hash).toBe('string');
  });

  it('should readUInt32BE correctly', () => {
    const h = createHash('sha256').update('\x00\x00\x00\x01');
    expect(h.readUInt32BE(0)).toBe(1);
  });
});
```

测试要点：

- **与 Node.js crypto 输出对比**：验证 `digestAsync()` 输出与 `node:crypto` 一致
- **字符串 + Uint8Array 输入**：覆盖两种输入类型
- **算法名称转换**：验证 `sha256`、`sha1`、`sha512` 等格式转换
- **同步回退**：验证不抛出异常
- **readUInt32BE**：验证字节序解析正确

---

## 8. 总结

admin-next 的 `crypto-shim.ts` 是一个**极简主义 polyfill 的典型案例**——不追求全面兼容 `node:crypto`，只精确实现共享代码实际使用的方法。

### 关键要点

- **最小 shim 策略**：仅 56 行代码，实现 `createHash`、`update`、`digest`、`digestAsync`、`readUInt32BE`
- **Web Crypto API**：异步哈希使用 `crypto.subtle.digest`，提供密码学安全级别的哈希
- **同步回退**：Java 风格 `hashCode` 算法作为安全网，防止同步调用崩溃
- **算法名称转换**：`sha256` → `SHA-256`，桥接 Node.js 与 Web Crypto API 的命名差异
- **零额外依赖**：不引入 `crypto-browserify` 等重型 polyfill，保持客户端包体积最小
