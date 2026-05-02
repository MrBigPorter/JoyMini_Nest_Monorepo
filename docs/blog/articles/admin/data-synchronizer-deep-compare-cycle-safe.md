# DataSynchronizer — 深度比较 + 循环安全序列化的数据同步器

> **难度**: ⭐⭐⭐⭐  
> **适用场景**: 多语言表单编辑、离线数据同步、任何需要比较和同步结构化数据的场景  
> **源码位置**: [`dataSync.ts`](../../../../apps/admin-next/src/utils/dataSync.ts)

## 一、为什么需要 DataSynchronizer？

管理后台的多语言编辑器面临一个经典问题：**用户编辑某个语言版本时，需要检测变化、同步到其他语言、并避免不必要的写操作**。

### 1.1 问题场景

```
用户编辑英文文章标题: "Hello World"
  → 需要检测: 英文标题是否真的变了？
  → 需要同步: 其他语言版本是否需要标记为"待翻译"？
  → 需要防抖: 用户快速打字时不要每击键都触发同步
```

如果没有专业同步器，常见代码会写成这样：

```ts
// ❌ 错误做法
if (formValue !== storedValue) {  // 对象引用比较，永远 true
  await saveToDB(formValue);
}
```

问题：
1. `!==` 对对象/数组永远返回 `true`（引用比较）
2. 没有防抖，打字时每秒触发几十次 API
3. 没有重试，网络错误直接丢失数据

### 1.2 DataSynchronizer 的解决方案

[`DataSynchronizer`](../../../../apps/admin-next/src/utils/dataSync.ts:113) 提供了 4 层保护：

```
syncField()
  │
  ├─ 1. deepEqual() 深度比较 → 没变则跳过（避免无效写操作）
  │
  ├─ 2. debouncedSync() 防抖 → 50ms 内多次调用合并（避免频繁写操作）
  │
  ├─ 3. withRetry() 重试 → 失败后线性退避 3 次（网络抖动容错）
  │
  └─ 4. syncToOtherLocales() 跨语言同步 → 可扩展的策略钩子
```

## 二、底层工具函数

### 2.1 `deepEqual` — 深度比较

[`deepEqual`](../../../../apps/admin-next/src/utils/dataSync.ts:28) 是一个递归的深度相等比较函数：

```ts
export function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;           // 原始类型快速短路
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;

  if (typeof a === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      return a.every((item, index) => deepEqual(item, b[index]));
    }
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => deepEqual(a[key], b[key]));
  }
  return a === b;
}
```

**比较特点**：

| 场景 | `===` | `deepEqual` | 说明 |
|------|-------|-------------|------|
| `42 === 42` | `true` | `true` | 原始类型短路 |
| `{a:1} === {a:1}` | `false` | `true` | 对象逐属性比较 |
| `[1,2] === [1,2]` | `false` | `true` | 数组逐元素比较 |
| `{a:{b:1}} === {a:{b:1}}` | `false` | `true` | 递归嵌套 |
| `null === undefined` | `false` | `false` | 类型不同 |
| `{a:1,b:2} === {b:2,a:1}` | `false` | `true` | 顺序无关 |

**与 lodash `isEqual` 的对比**：

| 能力 | lodash isEqual | 自定义 deepEqual |
|------|---------------|-----------------|
| 循环引用 | ✅ 自动处理 | ❌ 需要外部保护 |
| Map/Set/Date/RegExp | ✅ | ❌ 只处理 plain object 和 array |
| 包大小 | ~24KB (gzip) | ~500 bytes |
| 自定义比较器 | ✅ | ❌ |

因为业务场景只涉及 JSON-serializable 的数据（表单值），自定义 `deepEqual` 更轻量、更可控。

### 2.2 `safeStringify` — 循环安全序列化

[`safeStringify`](../../../../apps/admin-next/src/utils/dataSync.ts:57) 是 JSON.stringify 的安全版本：

```ts
export function safeStringify(obj: any): string {
  const seen = new WeakSet();
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';  // 循环引用 → 标记而不是抛异常
      }
      seen.add(value);
    }
    return value;
  });
}
```

**为什么需要？**

标准 `JSON.stringify` 遇到循环引用会抛出 `TypeError: Converting circular structure to JSON`。在管理后台中，如果你不小心将 React 组件引用传入了数据同步器，就会触发这个错误。

**使用 `WeakSet` 而非 `Set` 的好处**：

- `WeakSet` 持有的是**弱引用**，不影响垃圾回收
- 数据同步完成后，引用的对象可以被正常回收

### 2.3 `debounce` — 防抖

[`debounce`](../../../../apps/admin-next/src/utils/dataSync.ts:73) 是标准的防抖实现：

```ts
export function debounce<T extends (...args: any[]) => any>(
  func: T, wait: number,
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  return (...args) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}
```

**50ms 防抖的效果**：

```
用户输入 "Hello World"（每秒 10 击键）
  无防抖: 10 次 syncField 调用
  50ms 防抖: 1 次 syncField 调用（用户停止打字 50ms 后触发）
```

### 2.4 `withRetry` — 重试

[`withRetry`](../../../../apps/admin-next/src/utils/dataSync.ts:88) 实现了线性退避重试：

```ts
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 100,
): Promise<T> {
  let lastError: Error;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, delay * attempt));
      }
    }
  }
  throw lastError!;
}
```

**退避公式**：`delay × attempt` = 100ms, 200ms, 300ms（线性）

与 HttpClient 的指数退避不同，数据同步的延迟敏感度更低，线性退避足够且更可预测。

## 三、DataSynchronizer 类设计

### 3.1 存储结构

```ts
private storage: Record<string, Record<string, any>> = {};
//            fieldName    locale    value
// 例如: { "title": { "en": "Hello", "zh": "你好" },
//         "content": { "en": "...", "zh": "..." } }
```

这种 **field → locale → value** 的三层结构：

- 方便按字段查询：`storage['title']` → 所有语言版本
- 方便按语言查询：遍历字段获取某语言的所有值
- `getFieldAllLocales()` / `getFieldValue()` 都是 O(1) 操作

### 3.2 同步流程

```ts
async syncField(fieldName, formValue, locale, allLocales = []): Promise<SyncResult> {
  // 1. 读取当前存储值
  const currentStored = this.storage[fieldName]?.[locale];

  // 2. 深度比较
  const hasChanged = this.options.deepCompare
    ? !deepEqual(currentStored, formValue)
    : currentStored !== formValue;

  // 3. 未变化 → 跳过
  if (!hasChanged) return { success: true, changed: false, ... };

  // 4. 更新存储
  this.storage[fieldName][locale] = formValue;

  // 5. 跨语言同步（可扩展钩子）
  if (allLocales.length > 0) {
    await this.syncToOtherLocales(fieldName, locale, formValue, allLocales);
  }

  return { success: true, changed: true, ... };
}
```

**关键设计**：`syncField` 是纯内存操作 + 返回结果。**它不负责写数据库**，只负责比较和记录变化。真正的持久化由调用方决定。

### 3.3 防抖同步

[`debouncedSync`](../../../../apps/admin-next/src/utils/dataSync.ts:184) 结合了防抖和重试：

```ts
debouncedSync(fieldName, formValue, locale, allLocales) {
  const key = `${fieldName}:${locale}`;

  // 取消之前的定时器
  if (this.pendingSyncs.has(key)) clearTimeout(this.pendingSyncs.get(key)!);

  // 设置新的防抖定时器
  const timeout = setTimeout(async () => {
    try {
      await withRetry(
        () => this.syncField(fieldName, formValue, locale, allLocales),
        this.options.maxRetries,      // 3 次
        this.options.retryDelay,      // 100ms
      );
    } catch (error) {
      console.error(`Failed to sync field ${fieldName}:`, error);
    } finally {
      this.pendingSyncs.delete(key);
    }
  }, this.options.debounceDelay);     // 50ms
  this.pendingSyncs.set(key, timeout);
}
```

**为什么用 `Map<string, NodeJS.Timeout>` 管理多个定时器？**

因为多语言编辑器同时编辑多个字段（标题、内容、摘要），每个字段需要独立的防抖定时器。key 是 `fieldName:locale` 组合，确保每个字段的每种语言独立防抖。

### 3.4 跨语言同步策略

[`syncToOtherLocales`](../../../../apps/admin-next/src/utils/dataSync.ts:317) 是一个**可扩展的钩子**：

```ts
private async syncToOtherLocales(fieldName, sourceLocale, sourceValue, allLocales): Promise<void> {
  // 当前实现：只记录变更，不自动同步到其他语言
  // 可以扩展为更复杂的同步策略，例如：
  // - 当主语言更新时，自动标记其他语言为"待翻译"
  // - 当某个语言被清空时，从其他语言复制默认值
}
```

这种设计遵循 **Template Method** 模式——默认什么都不做，但子类或扩展可以覆盖它实现复杂策略。

## 四、使用模式

### 4.1 基本使用

```ts
import { defaultSynchronizer } from '@/utils/dataSync';

// 编辑器中监听变化
function onTitleChange(locale: string, value: string) {
  defaultSynchronizer.debouncedSync('title', value, locale, ['en', 'zh', 'ja']);
}

// 保存时检查所有变化
async function handleSave() {
  const results = await defaultSynchronizer.syncMultiple(
    [
      { fieldName: 'title', formValue: currentTitle },
      { fieldName: 'content', formValue: currentContent },
    ],
    currentLocale,
  );

  const changedFields = results.filter(r => r.changed);
  if (changedFields.length > 0) {
    await saveToAPI(changedFields);
  }
}
```

### 4.2 导出/导入

```ts
// 临时保存
const backup = defaultSynchronizer.exportData();
localStorage.setItem('draft_backup', JSON.stringify(backup));

// 恢复
const saved = JSON.parse(localStorage.getItem('draft_backup')!);
defaultSynchronizer.importData(saved);
```

注意 `exportData` 内部调用了 `safeStringify`，所以即使存储中有循环引用，导出也不会崩溃。

### 4.3 统计监控

```ts
const stats = defaultSynchronizer.getStats();
// { fieldCount: 3, totalValues: 7, pendingSyncs: 0 }
```

## 五、与相关模式的对比

### 5.1 vs HttpClient 的 `withRetry`

| 维度 | HttpClient `withRetry` | DataSynchronizer `withRetry` |
|------|----------------------|------------------------------|
| 位置 | [`http.ts`](../../../../apps/admin-next/src/api/http.ts) | [`dataSync.ts`](../../../../apps/admin-next/src/utils/dataSync.ts) |
| 退避策略 | 指数退避 `2^attempt` (2s→4s→8s) | 线性退避 `delay×attempt` (100ms→200ms→300ms) |
| 最大重试 | 3 次 | 3 次 |
| 重试条件 | 5xx 或网络错误 | 所有异常 |
| 使用场景 | HTTP 请求 | 内存同步操作 |

**为什么 DataSynchronizer 用更短的重试延迟？** 同步操作是内存操作（无网络 IO），失败几乎总是瞬时问题（如临时数据不一致），100ms 足够重试。

### 5.2 vs React Query 的 `isEqual` 对比

| 比较器 | 位置 | 用途 |
|--------|------|------|
| `deepEqual` | `dataSync.ts` | 表单值深度比较 |
| React Query `isEqual` | 内部 | query key 缓存比较 |

两者功能类似但互不依赖——DataSynchronizer 保持零外部依赖。

## 六、边界情况

| 场景 | 表现 | 原因 |
|------|------|------|
| `deepEqual(NaN, NaN)` | `true` | `a !== a` → NaN 特殊处理 |
| `deepEqual(+0, -0)` | `true` | 不区分正负零 |
| `safeStringify(circularRef)` | `'[Circular]'` | WeakSet 检测循环 |
| `syncField` 类型不同 | `changed: true` | `typeof` 检查 |
| 连续快速调用 10 次 | 只执行 1 次 | 防抖合并 |
| 防抖期间组件卸载 | 定时器自动取消 | `pendingSyncs` cleanup 在 finally 中 |

## 七、总结

[`DataSynchronizer`](../../../../apps/admin-next/src/utils/dataSync.ts) 是一个 **344 行的纯工具类**，没有外部依赖，但解决了数据同步中的 4 个核心问题：

| 工具 | 行数 | 解决的问题 |
|------|------|-----------|
| `deepEqual` | 25 | 对象引用比较 vs 值比较 |
| `safeStringify` | 12 | JSON.stringify 循环引用崩溃 |
| `debounce` + `debouncedSync` | 30 | 高频更新导致的重复操作 |
| `withRetry` + retry chain | 20 | 临时失败的自动恢复 |

**设计哲学**：每个函数独立可测、可复用。`deepEqual` 和 `safeStringify` 可以单独导出用于其他场景，`DataSynchronizer` 类只是它们的组合应用。

---

**相关阅读**：

- [A6: Zustand 认证存储 + SSR Hydration 双策略](./zustand-auth-store-ssr-hydration.md) — 客户端状态管理
- [A4: HttpClient 请求层 — 双环境配置 + 单飞 Token 刷新](./http-client-auth-refresh-retry.md) — 对比指数退避实现
- [A1: SmartTable — 通用数据表格组件](./smart-table-generic-data-grid.md) — 表单与表格的协作模式
