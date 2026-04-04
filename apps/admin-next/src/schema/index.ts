import { z } from 'zod';

export const imageFileSchema = z
  .union([
    // 编辑场景：已经有的 URL
    z.string().url().min(1, 'Invalid image URL'),

    // 创建/编辑：用户新上传的 File
    z.instanceof(File),
  ])
  .refine(
    (value) => {
      // 已有 URL：不做更多限制，前面 url().min(1) 已经校验过
      if (typeof value === 'string') return true;

      // File：类型 + 大小限制
      const isImage = value.type.startsWith('image/');
      const under5M = value.size <= 5 * 1024 * 1024; // 5MB

      return isImage && under5M;
    },
    { message: 'Please upload an image (max 5MB)' },
  );

// ================= 安全验证 Schema =================

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

/**
 * 通用文本验证（防XSS）
 */
export const safeTextSchema = z
  .string()
  .max(1000, '文本过长')
  .refine(
    (value) => {
      // 检查是否包含危险字符
      const dangerousPatterns = [
        /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
        /javascript:/gi,
        /on\w+\s*=/gi,
        /<iframe/gi,
        /<object/gi,
        /<embed/gi,
      ];
      return !dangerousPatterns.some((pattern) => pattern.test(value));
    },
    { message: '输入包含不安全内容' },
  );

/**
 * 用户注册表单验证
 */
export const userRegistrationSchema = z
  .object({
    username: usernameSchema,
    email: emailSchema,
    phone: phoneSchema.optional(),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: '密码确认不匹配',
    path: ['confirmPassword'],
  });

/**
 * 用户登录表单验证
 */
export const userLoginSchema = z.object({
  username: z.string().min(1, '请输入用户名'),
  password: z.string().min(1, '请输入密码'),
});

/**
 * 支付信息验证
 */
export const paymentSchema = z.object({
  amount: amountSchema,
  cardNumber: z
    .string()
    .regex(/^\d{16}$/, '银行卡号必须是16位数字')
    .transform((val) => val.replace(/(\d{4})\d{8,12}(\d{4})/, '$1****$2')), // 自动脱敏
  phone: phoneSchema,
  email: emailSchema.optional(),
});
