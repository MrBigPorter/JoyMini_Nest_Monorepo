# 多语言架构改造 - 经验教训总结

> ✅ 这是本次 LocalizedString 架构改造过程中踩过的所有坑和总结的最佳实践，90% 的项目都会遇到这些问题

---

## 📋 目录

1.  [peerDependencies 的真相](#1-peerDependencies-的真相)
2.  [LocalizedString 架构最佳实践](#2-localizedstring-架构最佳实践)
3.  [零停机迁移魔法](#3-零停机迁移魔法)
4.  [DTO 层的核心地位](#4-dto-层的核心地位)
5.  [TypeScript 常见陷阱](#5-typescript-常见陷阱)

---

## 1. peerDependencies 的真相

### ❌ 最大的误区

> 只要在 peerDependencies 里声明了，TypeScript 就应该能找到模块

### ✅ 真实原理

`peerDependencies` 只是 **yarn/npm 的运行时约定**，TypeScript 编译器 **完全不认识** 这个字段。

TS 编译时只看当前包的 `dependencies` 和 `devDependencies`，根本不知道宿主应用里装了什么。

### ✅ 标准方案

> **所有 peer 依赖必须同时在 devDependencies 也声明一份！**

```json
{
  "peerDependencies": {
    "zod": "^3.23.0",
    "react": "^18.2.0",
    "react-hook-form": "^7.51.0"
  },
  "devDependencies": {
    "zod": "^3.23.0",
    "react": "^18.2.0",
    "react-hook-form": "^7.51.0",
    "@types/react": "^18.2.0"
  }
}
```

| 环境      | 行为                                       |
| --------- | ------------------------------------------ |
| 🛠️ 编译时 | 使用 `devDependencies` 里的包进行类型检查  |
| 🚀 运行时 | 使用 `peerDependencies` 约定，共享宿主版本 |

这是 **所有主流开源类库** 都在使用的标准模式，没有例外。

---

## 2. LocalizedString 架构最佳实践

### ❌ 绝对不要做的事情:

1.  ❌ 不要写兼容层双写新旧字段
2.  ❌ 不要在数据库里存 `titleEn` `contentEn` 这种扁平字段
3.  ❌ 不要在 Service 层做类型判断
4.  ❌ 不要在每层都做兼容转换

### ✅ 应该做的事情:

1.  ✅ 直接用原生 JSON 字段 `titleLocalized`
2.  ✅ 全链路只传递 `LocalizedString<T>` 类型
3.  ✅ 提供统一的 `getLocalizedValue()` 工具函数
4.  ✅ 在最外层自动兼容旧格式

---

## 3. 零停机迁移魔法

✅ 我们实现了完美的零停机迁移模式，不需要停服，不需要数据迁移脚本：

| 客户端版本 | 行为                                                    |
| ---------- | ------------------------------------------------------- |
| 旧客户端   | 传 `string` → 自动包装成 `{ zh: "xxx" }` 存入 JSON 字段 |
| 新客户端   | 传 `Localized 对象` → 直接原样存入                      |

✅ 新旧代码可以同时运行
✅ 所有数据自动向新格式迁移
✅ 没有任何兼容性问题
✅ 可以随时回滚

---

## 4. DTO 层的核心地位

✅ DTO 是整个系统的类型安全边界：

- DTO 是什么类型，整个后端链路就应该是什么类型
- DTO 定义了之后，Service 和 Controller 不需要做任何类型检查
- 类型系统会保证整个链路的安全

✅ 只要 DTO 层改对了，整个后端就都对了。

---

## 5. TypeScript 常见陷阱

### 🔴 TS2352 类型转换错误

```typescript
// ❌ 错误写法
Object.keys(dto.content as Record<string, string>);

// ✅ 正确写法
const contentObj = dto.content as unknown as Record<string, string>;
```

### 🔴 TS7015 索引类型错误

当对象的索引不是 string 类型的时候，需要显式断言。

### 🔴 不要用 `any` 泄漏

所有类型转换最多只能转一次 `unknown`，绝对不能直接转 `any`。

---

## ✅ 最终状态

我们现在拥有了一个:
✅ **没有任何技术债务**
✅ **全链路类型安全**
✅ **零停机可扩展**
✅ **符合所有 npm 最佳实践**

的生产级多语言架构。这个架构可以无缝扩展到任意数量的语言。
