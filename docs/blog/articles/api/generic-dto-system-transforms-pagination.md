# 通用 DTO 系统：Transform 装饰器工厂 + 分页 DTO

> **源码参考**: [`transforms.ts`](apps/api/src/common/dto/transforms.ts) (459 行)

---

## 概述

NestJS 中 DTO（Data Transfer Object）是请求验证和数据转换的核心。本系统提供了两套 Transform 工具：

1. **Input DTO 装饰器**: 接收前端参数时宽松清洗（`toClassOnly`）
2. **Output DTO 装饰器**: 返回响应时安全格式化（Prisma Decimal/BigInt 处理）

---

## 一、Input DTO 装饰器

所有 Input 装饰器配置 `{ toClassOnly: true }`，确保只在 `plainToInstance` 接收数据时运行。

### 1.1 基础工具函数

```typescript
/** 判断值是否为空 */
const isEmpty = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** 安全转 Number */
const safeNumber = (v: unknown): number | undefined => {
  if (isEmpty(v)) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** 安全转 Int */
const safeInt = (v: unknown): number | undefined => {
  const n = safeNumber(v);
  if (n === undefined) return undefined;
  const i = Math.trunc(n);
  return Number.isFinite(i) ? i : undefined;
};
```

`Number.isFinite()` 防止 `NaN`、`Infinity` 等异常值通过验证。

### 1.2 数字转换

```typescript
@IsOptional()
@ToNumber()
page?: number;  // '1' → 1, '' → undefined

@IsOptional()
@ToInt()
pageSize?: number;  // '10' → 10, '1.5' → 1 (Math.trunc)
```

```typescript
export function ToNumber() {
  return applyDecorators(
    Transform(({ value }) => safeNumber(value), { toClassOnly: true }),
  );
}

export function ToInt() {
  return applyDecorators(
    Transform(({ value }) => safeInt(value), { toClassOnly: true }),
  );
}
```

### 1.3 布尔转换

```typescript
export function ToBool() {
  return applyDecorators(
    Transform(({ value }) => {
      if (isEmpty(value)) return undefined;
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') {
        if (value === 1) return true;
        if (value === 0) return false;
        return undefined;
      }
      const v = String(value).trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(v)) return true;
      if (['false', '0', 'no', 'off'].includes(v)) return false;
      return undefined;
    }, { toClassOnly: true }),
  );
}
```

**宽松输入支持**: `true` / `'true'` / `'1'` / `'yes'` / `'on'` 全部可以解析为布尔值 `true`。这对查询参数尤其重要，因为 URL 查询字符串全是字符串。

### 1.4 字符串清洗

```typescript
export function ToTrimmedString() {
  return applyDecorators(
    Transform(({ value }) => {
      if (isEmpty(value)) return undefined;
      const s = String(value).trim();
      return s.length > 0 ? s : undefined;  // 纯空格 → undefined
    }, { toClassOnly: true }),
  );
}

export function ToLowerCase() {
  return applyDecorators(
    Transform(({ value }) => {
      if (isEmpty(value)) return undefined;
      return String(value).trim().toLowerCase();
    }, { toClassOnly: true }),
  );
}

export function ToUpperCase() {
  return applyDecorators(
    Transform(({ value }) => {
      if (isEmpty(value)) return undefined;
      return String(value).trim().toUpperCase();
    }, { toClassOnly: true }),
  );
}
```

### 1.5 空值清洗

```typescript
export function ToNull() {
  return applyDecorators(
    Transform(({ value }) => {
      if (value === undefined || value === null) return null;  // undefined → null
      if (typeof value === 'string') {
        const v = value.trim();
        if (v === '' || v.toLowerCase() === 'null') return null;  // 'null' → null
      }
      return value;
    }, { toClassOnly: true }),
  );
}
```

**为什么需要这个？**

Prisma 中 `unique` 字段不能有多个 `null`，但可以有多个 `null`？实际上在 PostgreSQL 中，`UNIQUE` 约束允许多个 `NULL` 值。但某些业务逻辑要求空字符串和 `"null"` 字符串需要被清洗为真正的 `null`。

### 1.6 手机号清洗

```typescript
export function ToPurePhone() {
  return applyDecorators(
    Transform(({ value }) => {
      if (isEmpty(value)) return undefined;
      return String(value).replace(/\D/g, '');  // 只保留数字
    }, { toClassOnly: true }),
  );
}
```

用户可能输入 `+63 912 345 6789` 或 `0912-345-6789`，清洗后统一为 `639123456789`。

### 1.7 数组转换

```typescript
export function ToIntArray(opts: { delimiter?: string } = {}) {
  const { delimiter = ',' } = opts;
  return applyDecorators(
    Transform(({ value }) => {
      if (isEmpty(value)) return undefined;

      const arr = Array.isArray(value)
        ? value
        : String(value).split(delimiter);

      const nums = arr
        .map((v) => safeInt(v))
        .filter((n): n is number => typeof n === 'number');

      return Array.from(new Set(nums));  // 去重
    }, { toClassOnly: true }),
  );
}
```

**示例**: `?ids=1,1,a,2,3` → `[1, 2, 3]`（过滤非数字 + 去重）

### 1.8 日期与 JSON

```typescript
export function ToDate() {
  return applyDecorators(
    Transform(({ value }) => {
      if (isEmpty(value)) return undefined;
      const d = new Date(value);
      return isNaN(d.getTime()) ? undefined : d;
    }, { toClassOnly: true }),
  );
}

export function ToJsonObject() {
  return applyDecorators(
    Transform(({ value }) => {
      if (isEmpty(value)) return undefined;
      if (typeof value === 'object') return value;
      try { return JSON.parse(String(value)); }
      catch { return undefined; }
    }, { toClassOnly: true }),
  );
}
```

---

## 二、Output DTO 装饰器

Output 装饰器用于 **从 DB 到 Response** 的转换，主要解决 Prisma 的 Decimal/BigInt 类型问题。

### 2.1 Decimal 处理

**问题**: Prisma 返回的 `Decimal` 类型在 `JSON.stringify` 时会被序列化为 `{ "type": "Buffer" }` 或引发异常。

#### `DecimalToString()`

```typescript
export function DecimalToString(
  fractionDigits: number = 2,
  defaultValue: string = '0.00',
) {
  return applyDecorators(
    Type(() => String),
    Transform(({ value }) => {
      // 1. 空值拦截
      if (value === undefined || value === null) return defaultValue;

      try {
        // 2. 处理 Prisma.Decimal 实例
        if (typeof value === 'object' && 'toFixed' in value) {
          return (value as any).toFixed(fractionDigits);
        }

        // 3. 处理普通数字/字符串
        const d = new Decimal(String(value ?? ''));
        if (d.isNaN()) return defaultValue;
        return d.toFixed(fractionDigits);
      } catch {
        console.warn('[DecimalTransform] Error parsing value:', value);
        return defaultValue;
      }
    }),
  );
}
```

**三层防御**:
1. `value === undefined || null` → 返回默认值 (`'0.00'`)
2. `value` 是 Prisma.Decimal 对象 → 调用 `toFixed()` 方法
3. `value` 是普通字符串/数字 → 通过 `new Decimal()` 安全转换

#### `DecimalToNumber()`

```typescript
export function DecimalToNumber(defaultValue: number | null = 0) {
  return applyDecorators(
    Type(() => Number),
    Transform(({ value }) => {
      if (isEmpty(value)) return defaultValue;
      // Prisma.Decimal 实例
      if (typeof value === 'object' && value !== null && 'toNumber' in value) {
        try { return value.toNumber(); }
        catch { return defaultValue; }
      }
      const n = Number(value);
      return Number.isFinite(n) ? n : defaultValue;
    }),
  );
}
```

### 2.2 BigInt 处理

```typescript
export function BigIntToString() {
  return applyDecorators(
    Type(() => String),
    Transform(({ value }) => {
      if (value === null || value === undefined) return null;
      return String(value);  // BigInt → "1234567890123"
    }),
  );
}
```

**为什么需要？**: `JSON.stringify` 无法序列化 `BigInt`，会抛 `TypeError: Do not know how to serialize a BigInt`。

### 2.3 时间戳转换

```typescript
export function DateToTimestamp() {
  return applyDecorators(
    Type(() => Date),
    Transform(({ value }) => {
      if (value === null || value === undefined) return null;

      if (value instanceof Date) {
        const t = value.getTime();
        return Number.isFinite(t) ? t : null;
      }
      if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
      }
      if (typeof value === 'string') {
        const d = new Date(value);
        const t = d.getTime();
        return Number.isFinite(t) ? t : null;
      }
      return null;
    }),
  );
}
```

统一将 `Date | string | number` 转换为毫秒时间戳（`number`），前端可以直接使用 `new Date(timestamp)`。

### 2.4 字符串脱敏

```typescript
export function MaskString(
  type: 'phone' | 'email' | 'idcard' | 'bankcard' | 'name' = 'phone',
) {
  return applyDecorators(
    Type(() => String),
    Transform(({ value }) => {
      if (isEmpty(value)) return null;
      const str = String(value);

      switch (type) {
        case 'phone':
          return str.replace(/^(\d{3})\d+(\d{4})$/, '$1****$2');
          // 09123456789 → 091****6789

        case 'email':
          const [name, domain] = str.split('@');
          return `${name.slice(0, 2)}***${name.slice(-1)}@${domain}`;
          // admin@gmail.com → ad***n@gmail.com

        case 'bankcard':
          return `${str.slice(0, 4)}${'*'.repeat(str.length - 8)}${str.slice(-4)}`;
          // 6222026000001234 → 6222********1234

        case 'idcard':
          return str.replace(/^(\w{6})\w+(\w{4})$/, '$1********$2');
          // 110101199001011234 → 110101********1234

        case 'name':
          if (str.length <= 1) return '*';
          if (str.length === 2) return `${str[0]}*`;
          const maskLen = Math.min(3, str.length - 2);
          return `${str[0]}${'*'.repeat(maskLen)}${str[str.length - 1]}`;
          // "LuckyStar" → "L***r"
      }
    }),
  );
}
```

### 2.5 URL 拼接

```typescript
export function ToUrl(prefix: string) {
  return applyDecorators(
    Type(() => String),
    Transform(({ value }) => {
      if (isEmpty(value)) return null;
      const str = String(value);

      // 已经是完整 URL
      if (str.startsWith('http://') || str.startsWith('https://')) return str;

      const cleanPrefix = prefix.replace(/\/$/, '');
      const cleanValue = str.replace(/^\//, '');
      return `${cleanPrefix}/${cleanValue}`;
    }),
  );
}
```

**使用场景**: 数据库只存文件路径 `uploads/avatar/123.jpg`，响应时自动拼接 CDN 前缀 `https://cdn.example.com/uploads/avatar/123.jpg`。

---

## 三、手机号验证

### `IsSmartPhone()`

```typescript
export function IsSmartPhone(options?: PhoneOptions) {
  const { strictPH = true, ...validationOptions } = options || {};

  return applyDecorators(
    Transform(({ value }) => {
      if (typeof value !== 'string') return value;

      const phoneNumber = parsePhoneNumberFromString(value, 'PH');

      if (phoneNumber && phoneNumber.isValid()) {
        if (strictPH && phoneNumber.country !== 'PH') return value; // 不修改
        const t = phoneNumber.getType();
        if (t !== 'MOBILE' && t !== 'FIXED_LINE_OR_MOBILE') return value;
        return phoneNumber.number; // E.164 格式
      }
      return value;
    }, { toClassOnly: true }),

    IsPhoneNumber(strictPH ? 'PH' : undefined, {
      message: strictPH
        ? 'Invalid Philippines phone number format'
        : 'Invalid phone number format',
    }),
  );
}
```

**校验流程**:
1. Transform: 将菲律宾手机号标准化为 E.164 格式（如 `+639123456789`）
2. IsPhoneNumber: 使用 `libphonenumber-js` 验证格式

**严格模式 (`strictPH: true`)**:
- 只允许 `+63`（菲律宾）号码
- 必须是移动电话（`MOBILE` 或 `FIXED_LINE_OR_MOBILE`）

---

## 四、分页 DTO

### PaginateDto

```typescript
export class PaginateDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @ToInt()
  page?: number = 1;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @ToInt()
  pageSize?: number = 10;
}
```

### 通用分页响应

```typescript
export class PaginatedResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}
```

---

## 总结

这套 DTO 系统解决了 NestJS + Prisma 项目中的四个核心痛点：

| 痛点 | 解决方案 |
|------|----------|
| 查询参数全是字符串 | `ToNumber()` / `ToInt()` / `ToBool()` 自动转换 |
| Prisma Decimal 序列化崩溃 | `DecimalToString()` / `DecimalToNumber()` 安全输出 |
| BigInt JSON 序列化异常 | `BigIntToString()` 转为字符串 |
| 敏感数据暴露 | `MaskString()` 自动脱敏 |
| 手机号国际化 | `IsSmartPhone()` 基于 `libphonenumber-js` 的 E.164 标准化 |
