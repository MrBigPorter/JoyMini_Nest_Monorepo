/**
 * 安全工具函数
 * 提供输入验证、数据脱敏、XSS防护等安全功能
 */

import { z } from 'zod';

// ================= 输入验证 Schema =================

/**
 * 手机号验证（支持国际格式）
 */
export const phoneSchema = z
  .string()
  .min(10, '手机号至少10位')
  .max(15, '手机号最多15位')
  .regex(/^\+?[1-9]\d{6,14}$/, '请输入有效的手机号');

/**
 * 邮箱验证
 */
export const emailSchema = z
  .string()
  .email('请输入有效的邮箱地址')
  .max(100, '邮箱地址过长');

/**
 * 用户名验证
 */
export const usernameSchema = z
  .string()
  .min(2, '用户名至少2个字符')
  .max(50, '用户名最多50个字符')
  .regex(
    /^[a-zA-Z0-9_\u4e00-\u9fa5]+$/,
    '用户名只能包含字母、数字、下划线和中文',
  );

/**
 * 密码验证
 */
export const passwordSchema = z
  .string()
  .min(8, '密码至少8个字符')
  .max(128, '密码最多128个字符')
  .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, '密码必须包含大小写字母和数字');

/**
 * 金额验证
 */
export const amountSchema = z
  .number()
  .min(0, '金额不能为负数')
  .max(999999.99, '金额过大')
  .multipleOf(0.01, '金额最多两位小数');

// ================= 数据脱敏函数 =================

/**
 * 手机号脱敏
 * 13812341234 -> 138****1234
 */
export function maskPhone(phone: string): string {
  if (!phone || phone.length < 7) return phone;
  return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
}

/**
 * 银行卡号脱敏
 * 6222021234567890123 -> 6222****0123
 */
export function maskBankCard(card: string): string {
  if (!card || card.length < 8) return card;
  return card.replace(/(\d{4})\d{8,12}(\d{4})/, '$1****$2');
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

/**
 * 姓名脱敏
 * 张三 -> 张*
 * 李小明 -> 李*明
 */
export function maskName(name: string): string {
  if (!name || name.length < 2) return name;
  if (name.length === 2) {
    return `${name[0]}*`;
  }
  return `${name[0]}*${name.slice(-1)}`;
}

// ================= XSS 防护 =================

/**
 * HTML 转义，防止 XSS 攻击
 */
export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&',
    '<': '<',
    '>': '>',
    '"': '"',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

/**
 * 清理 HTML 标签，只保留纯文本
 */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

/**
 * 验证并清理用户输入
 */
export function sanitizeInput(input: string): string {
  // 移除危险字符
  let cleaned = input.replace(/[<>]/g, '');
  // 移除 script 标签
  cleaned = cleaned.replace(/script/gi, '');
  // 移除事件处理器
  cleaned = cleaned.replace(/on\w+=/gi, '');
  return cleaned.trim();
}

// ================= CSRF 防护 =================

/**
 * 生成 CSRF Token
 */
export function generateCsrfToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

/**
 * 验证 CSRF Token
 */
export function validateCsrfToken(token: string, storedToken: string): boolean {
  return token === storedToken && token.length === 64;
}

// ================= 安全检查函数 =================

/**
 * 检查是否包含 SQL 注入关键词
 */
export function containsSqlInjection(input: string): boolean {
  const sqlKeywords = [
    'SELECT',
    'INSERT',
    'UPDATE',
    'DELETE',
    'DROP',
    'UNION',
    'OR',
    'AND',
    'EXEC',
    'EXECUTE',
    'xp_',
    'sp_',
  ];
  const upperInput = input.toUpperCase();
  return sqlKeywords.some(
    (keyword) =>
      upperInput.includes(keyword) ||
      upperInput.includes(`'${keyword}`) ||
      upperInput.includes(`"${keyword}`),
  );
}

/**
 * 检查是否包含 XSS 攻击特征
 */
export function containsXss(input: string): boolean {
  const xssPatterns = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,
    /<iframe/gi,
    /<object/gi,
    /<embed/gi,
  ];
  return xssPatterns.some((pattern) => pattern.test(input));
}

/**
 * 综合安全检查
 */
export function securityCheck(input: string): {
  isSafe: boolean;
  threats: string[];
  cleaned: string;
} {
  const threats: string[] = [];
  let cleaned = input;

  // 检查 SQL 注入
  if (containsSqlInjection(input)) {
    threats.push('SQL注入');
    cleaned = cleaned.replace(/['";]/g, '');
  }

  // 检查 XSS
  if (containsXss(input)) {
    threats.push('XSS攻击');
    cleaned = sanitizeInput(cleaned);
  }

  // 检查长度
  if (input.length > 10000) {
    threats.push('输入过长');
    cleaned = cleaned.slice(0, 10000);
  }

  return {
    isSafe: threats.length === 0,
    threats,
    cleaned,
  };
}

// ================= 密码安全 =================

/**
 * 检查密码强度
 */
export function checkPasswordStrength(password: string): {
  score: number; // 0-4
  feedback: string[];
} {
  const feedback: string[] = [];
  let score = 0;

  if (password.length >= 8) score++;
  else feedback.push('密码至少8个字符');

  if (/[a-z]/.test(password)) score++;
  else feedback.push('需要小写字母');

  if (/[A-Z]/.test(password)) score++;
  else feedback.push('需要大写字母');

  if (/\d/.test(password)) score++;
  else feedback.push('需要数字');

  if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    score++;
    feedback.push('包含特殊字符（加分项）');
  }

  return { score, feedback };
}

/**
 * 生成安全的随机密码
 */
export function generateSecurePassword(length: number = 16): string {
  const charset =
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => charset[byte % charset.length]).join('');
}
