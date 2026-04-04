import { applyDecorators } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { IsPhoneNumber, ValidationOptions } from 'class-validator';
import Decimal from 'decimal.js';
import parsePhoneNumberFromString from 'libphonenumber-js';

// ==========================================
//   基础工具函数 (Internal Helpers)
// ==========================================

/** 判断值是否为空 (undefined, null, 空字符串, 纯空格) */
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

/** 安全转 Decimal string */
const safeDecimalToFixedString = (
  value: unknown,
  fractionDigits: number,
  defaultValue: string,
): string => {
  // 1. 彻底拦截空值，不进入任何 Decimal 逻辑
  if (value === undefined || value === null) return defaultValue;

  try {
    // 2. 针对 Prisma 返回的对象（带有 toFixed 的 Decimal 实例）
    if (
      typeof value === 'object' &&
      'toFixed' in value &&
      typeof (value as any).toFixed === 'function'
    ) {
      return (value as any).toFixed(fractionDigits);
    }

    // 3. 针对字符串或数字，确保 new Decimal 不会因为非法输入炸掉
    const d = new Decimal(String(value)); // 强制转 string 传给 Decimal 构造函数更稳
    if (d.isNaN()) return defaultValue;

    return d.toFixed(fractionDigits);
  } catch (err) {
    // 如果 value 还是让 Decimal 炸了（比如 value 是个莫名其妙的 object），返回默认值
    console.warn('[DecimalTransform] Error parsing value:', value);
    return defaultValue;
  }
};

// ==========================================
//  Input DTO 专用 (Query / Body -> DTO)
//    原则: 宽容处理，清洗数据，用于接收前端参数
//    配置: { toClassOnly: true } 确保只在接收数据时运行
// ==========================================

/** 数字转换：'1' -> 1, '1.5' -> 1.5, '' -> undefined */
export function ToNumber() {
  return applyDecorators(
    Transform(({ value }) => safeNumber(value), { toClassOnly: true }),
  );
}

/** 整数转换 */
export function ToInt() {
  return applyDecorators(
    Transform(({ value }) => safeInt(value), { toClassOnly: true }),
  );
}

/** 浮点转换 */
export function ToFloat() {
  return ToNumber();
}

/** 布尔转换：支持 'true', 'on', '1', 'yes' 等宽松输入 */
export function ToBool() {
  return applyDecorators(
    Transform(
      ({ value }) => {
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
      },
      { toClassOnly: true },
    ),
  );
}

/**
 * 将空字符串 ''、纯空格 '   ' 或字符串 'null' 转换为真正的 null
 * 用于 DTO 清洗（例如 unique 字段）
 */
export function ToNull() {
  return applyDecorators(
    Transform(
      ({ value }) => {
        if (value === undefined || value === null) return null;
        if (typeof value === 'string') {
          const v = value.trim();
          if (v === '' || v.toLowerCase() === 'null') return null;
        }
        return value;
      },
      { toClassOnly: true },
    ),
  );
}

/** 字符串清洗：去除首尾空格，空字符串转 undefined */
export function ToTrimmedString() {
  return applyDecorators(
    Transform(
      ({ value }) => {
        if (isEmpty(value)) return undefined;
        const s = String(value).trim();
        return s.length > 0 ? s : undefined;
      },
      { toClassOnly: true },
    ),
  );
}

/** 转小写 + Trim (Email, Username) */
export function ToLowerCase() {
  return applyDecorators(
    Transform(
      ({ value }) => {
        if (isEmpty(value)) return undefined;
        return String(value).trim().toLowerCase();
      },
      { toClassOnly: true },
    ),
  );
}

/** 转大写 + Trim (Codes, Currencies) */
export function ToUpperCase() {
  return applyDecorators(
    Transform(
      ({ value }) => {
        if (isEmpty(value)) return undefined;
        return String(value).trim().toUpperCase();
      },
      { toClassOnly: true },
    ),
  );
}

/** 手机号清洗：只保留数字 */
export function ToPurePhone() {
  return applyDecorators(
    Transform(
      ({ value }) => {
        if (isEmpty(value)) return undefined;
        return String(value).replace(/\D/g, '');
      },
      { toClassOnly: true },
    ),
  );
}

/** 整数数组：?ids=1,1,a,2 -> [1,2] (去重+过滤) */
export function ToIntArray(opts: { delimiter?: string } = {}) {
  const { delimiter = ',' } = opts;
  return applyDecorators(
    Transform(
      ({ value }) => {
        if (isEmpty(value)) return undefined;

        const arr = Array.isArray(value)
          ? value
          : String(value).split(delimiter);

        const nums = arr
          .map((v) => safeInt(v))
          .filter((n): n is number => typeof n === 'number');

        return Array.from(new Set(nums));
      },
      { toClassOnly: true },
    ),
  );
}

/** 日期字符串 -> Date 对象 */
export function ToDate() {
  return applyDecorators(
    Transform(
      ({ value }) => {
        if (isEmpty(value)) return undefined;
        const d = new Date(value);
        return isNaN(d.getTime()) ? undefined : d;
      },
      { toClassOnly: true },
    ),
  );
}

/** JSON 字符串 -> 对象 */
export function ToJsonObject() {
  return applyDecorators(
    Transform(
      ({ value }) => {
        if (isEmpty(value)) return undefined;
        if (typeof value === 'object') return value;
        try {
          return JSON.parse(String(value));
        } catch {
          return undefined;
        }
      },
      { toClassOnly: true },
    ),
  );
}

// ==========================================
//  Output DTO 专用 (DB/Plain -> Response DTO)
//    原则: 绝对安全，处理 Prisma Decimal/BigInt，格式化输出
//    注意：你们当前用 plainToInstance 输出，所以 Transform 默认即可（不要 toPlainOnly）
// ==========================================

/**
 * Decimal / Number / String -> String (保留小数位，永不炸)
 */
export function DecimalToString(
  fractionDigits: number = 2,
  defaultValue: string = '0.00',
) {
  return applyDecorators(
    // 提示 class-transformer：目标是 string
    Type(() => String),
    Transform(({ value }) => {
      return safeDecimalToFixedString(value, fractionDigits, defaultValue);
    }),
  );
}

/** Decimal / String / Number -> Number (注意精度风险) */
export function DecimalToNumber(defaultValue: number | null = 0) {
  return applyDecorators(
    Type(() => Number),
    Transform(({ value }) => {
      if (isEmpty(value)) return defaultValue;

      // Prisma.Decimal / Decimal.js 实例
      if (typeof value === 'object' && value !== null && 'toNumber' in value) {
        try {
          return value.toNumber();
        } catch {
          return defaultValue;
        }
      }

      const n = Number(value);
      return Number.isFinite(n) ? n : defaultValue;
    }),
  );
}

/** BigInt -> String (解决 JSON 序列化崩溃) */
export function BigIntToString() {
  return applyDecorators(
    Type(() => String),
    Transform(({ value }) => {
      if (value === null || value === undefined) return null;
      return String(value);
    }),
  );
}

/**
 * 强力转换：任意格式 (Date | string | number) -> Timestamp (毫秒 number)
 * 无效日期返回 null（不会 NaN）
 */
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

/** 字符串脱敏 (手机号/邮箱/卡号) */
export function MaskString(
  type: 'phone' | 'email' | 'idcard' | 'bankcard' | 'name' = 'phone',
) {
  return applyDecorators(
    Type(() => String),
    Transform(({ value }) => {
      if (isEmpty(value)) return null;
      const str = String(value);

      // 1. 手机号脱敏 (保留前3后4)
      // 示例: 09123456789 -> 091****6789
      if (type === 'phone' && str.length >= 7) {
        // 兼容不同长度的手机号，中间固定显示4个星号
        return str.replace(/^(\d{3})\d+(\d{4})$/, '$1****$2');
      }

      // 2. 邮箱脱敏
      // 示例: admin@gmail.com -> ad***n@gmail.com
      if (type === 'email' && str.includes('@')) {
        const [name, domain] = str.split('@');
        if (name.length <= 2) {
          return `${name}***@${domain}`;
        }
        return `${name.slice(0, 2)}***${name.slice(-1)}@${domain}`;
      }

      // 3. 银行卡脱敏 (保留前4后4)
      // 示例: 6222026000001234 -> 6222********1234
      if (type === 'bankcard' && str.length > 8) {
        const prefix = str.slice(0, 4);
        const suffix = str.slice(-4);
        // 中间剩余部分全部替换为星号，或者固定长度
        const maskLength = str.length - 8;
        return `${prefix}${'*'.repeat(maskLength)}${suffix}`;
      }

      // 4. 身份证脱敏 (保留前6后4)
      // 示例: 110101199001011234 -> 110101********1234
      if (type === 'idcard') {
        return str.replace(/^(\w{6})\w+(\w{4})$/, '$1********$2');
      }

      // 5. 🔥 [新增] 姓名/昵称脱敏
      if (type === 'name') {
        // 情况A: 只有一个字 (如: "刘") -> "*"
        if (str.length <= 1) {
          return '*';
        }

        // 情况B: 两个字 (如: "张三") -> "张*"
        if (str.length === 2) {
          return `${str[0]}*`;
        }

        // 情况C: 三个字及以上 (如: "欧阳锋", "LuckyStar")
        // 规则: 保留首尾，中间最多显示3个星号，防止名字太长全是星号
        // 示例: "LuckyStar" -> "L***r"
        const maskLen = Math.min(3, str.length - 2);
        return `${str[0]}${'*'.repeat(maskLen)}${str[str.length - 1]}`;
      }

      // 默认不处理
      return str;
    }),
  );
}

/** URL 拼前缀 (CDN) */
export function ToUrl(prefix: string) {
  return applyDecorators(
    Type(() => String),
    Transform(({ value }) => {
      if (isEmpty(value)) return null;
      const str = String(value);

      if (str.startsWith('http://') || str.startsWith('https://')) return str;

      const cleanPrefix = prefix.replace(/\/$/, '');
      const cleanValue = str.replace(/^\//, '');
      return `${cleanPrefix}/${cleanValue}`;
    }),
  );
}

// ==========================================
// Phone Validation (Input)
// ==========================================

export interface PhoneOptions extends ValidationOptions {
  /**
   * 是否严格限制为菲律宾号码？
   * - true (默认): 只允许 PH 号码，拒绝其他国家号码
   * - false: 允许全球号码，但如果无法识别国家，优先尝试解析为 PH
   */
  strictPH?: boolean;
}

export function IsSmartPhone(options?: PhoneOptions) {
  const { strictPH = true, ...validationOptions } = options || {};

  return applyDecorators(
    // ✅ 只在入参时清洗
    Transform(
      ({ value }) => {
        if (typeof value !== 'string') return value;

        const phoneNumber = parsePhoneNumberFromString(value, 'PH');

        if (phoneNumber && phoneNumber.isValid()) {
          if (strictPH && phoneNumber.country !== 'PH') {
            return value;
          }

          // 严格检查：必须是移动电话
          const t = phoneNumber.getType();
          if (t !== 'MOBILE' && t !== 'FIXED_LINE_OR_MOBILE') {
            return value;
          }

          return phoneNumber.number; // E.164
        }

        return value;
      },
      { toClassOnly: true },
    ),

    IsPhoneNumber(strictPH ? 'PH' : undefined, {
      message: strictPH
        ? 'Invalid Philippines phone number format'
        : 'Invalid phone number format',
      ...validationOptions,
    }),
  );
}
