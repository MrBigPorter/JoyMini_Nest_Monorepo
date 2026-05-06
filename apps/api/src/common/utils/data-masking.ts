import { Role } from '@lucky/shared';

/**
 * 手机号脱敏
 * 13812341234 -> 138****1234
 */
export function maskPhone(phone: string): string {
  if (!phone || phone.length < 7) return phone;
  return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
}

/**
 * 姓名脱敏
 * 张三 -> 张* / 李小明 -> 李*明
 */
export function maskName(name: string): string {
  if (!name || name.length < 2) return name;
  if (name.length === 2) {
    return `${name[0]}*`;
  }
  return `${name[0]}*${name.slice(-1)}`;
}

/**
 * 身份证号脱敏
 * 110101199001011234 -> 1101****1234
 */
export function maskIdCard(idCard: string): string {
  if (!idCard || idCard.length < 8) return idCard;
  return idCard.replace(/(\d{4})\d{10}(\d{4})/, '$1****$2');
}

/**
 * 邮箱脱敏
 * user@example.com -> u***@example.com
 */
export function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return email;
  const [local, domain] = email.split('@');
  if (local.length <= 1) return email;
  return `${local[0]}***@${domain}`;
}

type MaskFn = (value: string) => string;

interface MaskFieldConfig {
  [fieldPath: string]: MaskFn;
}

/**
 * Get a nested value from an object using dot-notation path.
 * e.g. getNestedValue(obj, 'user.nickname')
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split('.');
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Set a nested value on an object using dot-notation path.
 * e.g. setNestedValue(obj, 'user.nickname', 'm****')
 */
function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const keys = path.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (current[key] === undefined || current[key] === null) return;
    if (typeof current[key] !== 'object') return;
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}

/**
 * Apply masking functions to matching fields on a single object.
 * Supports dot-notation paths for nested fields.
 */
function applyMaskToObject(
  obj: Record<string, unknown>,
  fieldMap: MaskFieldConfig,
): Record<string, unknown> {
  for (const [fieldPath, maskFn] of Object.entries(fieldMap)) {
    const value = getNestedValue(obj, fieldPath);
    if (typeof value === 'string') {
      setNestedValue(obj, fieldPath, maskFn(value));
    }
  }
  return obj;
}

/**
 * Mask sensitive fields in API response data.
 * Only masks for VIEWER role — other roles see original data.
 *
 * Supports two data shapes:
 * 1. Single object: applies masks directly
 * 2. Paginated result ({ list: [...], total, page, pageSize }): applies masks to each item in `list`
 *
 * Field paths support dot-notation for nested fields (e.g. 'user.nickname').
 *
 * @example
 * ```ts
 * // Single object
 * maskSensitiveFields(user, req.user?.role, { nickname: maskName, phone: maskPhone });
 *
 * // Paginated result with nested fields
 * maskSensitiveFields(result, req.user?.role, { 'user.nickname': maskName, 'user.phone': maskPhone });
 * ```
 */
export function maskSensitiveFields<T>(
  data: T,
  role: string | undefined,
  fieldMap: MaskFieldConfig,
): T {
  // Only mask for VIEWER role
  if (role !== Role.VIEWER) return data;
  if (!data) return data;

  // Handle paginated result with a `list` array
  if (
    typeof data === 'object' &&
    !Array.isArray(data) &&
    data !== null &&
    'list' in data &&
    Array.isArray((data as Record<string, unknown>).list)
  ) {
    const paginated = data as Record<string, unknown>;
    paginated.list = (paginated.list as Record<string, unknown>[]).map(
      (item: Record<string, unknown>) => applyMaskToObject(item, fieldMap),
    );
    return data;
  }

  // Handle single object
  if (typeof data === 'object' && !Array.isArray(data) && data !== null) {
    return applyMaskToObject(data as Record<string, unknown>, fieldMap) as T;
  }

  return data;
}
