/**
 * 数据脱敏工具函数
 * 用于保护用户隐私信息，防止敏感数据泄露
 */

/**
 * 邮箱地址脱敏
 * @example user@example.com → us****@example.com
 */
export function maskEmail(email: string): string {
  if (!email || typeof email !== 'string') return email || '';

  const [localPart, domain] = email.split('@');
  if (!localPart || !domain) return email;

  // 保留前2个字符，其余用*替换
  if (localPart.length <= 2) {
    return `${localPart.charAt(0)}***@${domain}`;
  }

  const maskedLocal =
    localPart.charAt(0) + '*'.repeat(Math.min(localPart.length - 1, 4));
  return `${maskedLocal}@${domain}`;
}

/**
 * 手机号码脱敏
 * @example 13800138000 → 138****8000
 */
export function maskPhone(phone: string): string {
  if (!phone || typeof phone !== 'string') return phone || '';

  // 移除所有非数字字符
  const digits = phone.replace(/\D/g, '');

  if (digits.length < 7) return phone;

  // 中国手机号：前3位+中间4位脱敏+后4位
  if (digits.length === 11 && digits.startsWith('1')) {
    return `${digits.slice(0, 3)}****${digits.slice(7)}`;
  }

  // 通用规则：保留前3位和后4位，中间脱敏
  const visiblePrefix = digits.slice(0, 3);
  const visibleSuffix = digits.slice(-4);
  const maskedLength = Math.max(digits.length - 7, 1);

  return `${visiblePrefix}${'*'.repeat(maskedLength)}${visibleSuffix}`;
}

/**
 * 身份证号脱敏
 * @example 110101199001011234 → 110101********1234
 */
export function maskIdCard(idCard: string): string {
  if (!idCard || typeof idCard !== 'string') return idCard || '';

  // 15位或18位身份证号
  if (idCard.length === 15) {
    return `${idCard.slice(0, 6)}******${idCard.slice(12)}`;
  } else if (idCard.length === 18) {
    return `${idCard.slice(0, 6)}********${idCard.slice(14)}`;
  }

  // 其他格式：保留前6位和后4位
  if (idCard.length > 10) {
    return `${idCard.slice(0, 6)}${'*'.repeat(Math.max(idCard.length - 10, 1))}${idCard.slice(-4)}`;
  }

  return idCard;
}

/**
 * 银行卡号脱敏
 * @example 6228480402564890018 → 622848*********0018
 */
export function maskBankCard(bankCard: string): string {
  if (!bankCard || typeof bankCard !== 'string') return bankCard || '';

  // 移除所有非数字字符
  const digits = bankCard.replace(/\D/g, '');

  if (digits.length < 8) return bankCard;

  // 保留前6位和后4位
  return `${digits.slice(0, 6)}${'*'.repeat(Math.max(digits.length - 10, 1))}${digits.slice(-4)}`;
}

/**
 * 通用文本脱敏 - 检测并处理多种敏感信息
 */
export function maskSensitiveText(text: string): string {
  if (!text || typeof text !== 'string') return text || '';

  let maskedText = text;

  // 检测并脱敏邮箱
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  maskedText = maskedText.replace(emailRegex, (match) => maskEmail(match));

  // 检测并脱敏手机号（中国格式）
  const phoneRegex = /\b1[3-9]\d{9}\b/g;
  maskedText = maskedText.replace(phoneRegex, (match) => maskPhone(match));

  // 检测并脱敏身份证号
  const idCardRegex = /\b\d{15}\b|\b\d{17}[\dXx]\b/g;
  maskedText = maskedText.replace(idCardRegex, (match) => maskIdCard(match));

  // 检测并脱敏银行卡号（16-19位数字）
  const bankCardRegex = /\b\d{16,19}\b/g;
  maskedText = maskedText.replace(bankCardRegex, (match) =>
    maskBankCard(match),
  );

  // 检测并脱敏密码/令牌等敏感关键词
  const sensitiveKeywords = [
    'password',
    'passwd',
    'pwd',
    'token',
    'secret',
    'key',
    'credential',
    '密码',
    '口令',
    '令牌',
    '密钥',
    '凭证',
  ];

  sensitiveKeywords.forEach((keyword) => {
    const regex = new RegExp(
      `\\b${keyword}\\s*[:=]\\s*['"]?[^'"\\s]+['"]?`,
      'gi',
    );
    maskedText = maskedText.replace(regex, (match) => {
      return match.replace(/[:=]\s*['"]?[^'"\s]+['"]?/, ': ********');
    });
  });

  return maskedText;
}

/**
 * 评论内容脱敏 - 专门处理评论中的敏感信息
 */
export function maskCommentContent(content: string): string {
  if (!content || typeof content !== 'string') return content || '';

  // 首先进行通用敏感信息脱敏
  let maskedContent = maskSensitiveText(content);

  // 额外处理：防止个人信息泄露
  // 1. 移除或脱敏详细地址信息
  const addressRegex =
    /(?:(?:省|市|区|县|街道|路|号|小区|大厦|公寓|单元|室|楼|栋)[\u4e00-\u9fa5\d\s\-]+){3,}/g;
  maskedContent = maskedContent.replace(addressRegex, (match) => {
    // 保留前几个字符，其余用*替换
    if (match.length > 10) {
      return `${match.slice(0, 6)}****${match.slice(-4)}`;
    }
    return '****';
  });

  // 2. 防止社交账号泄露（微信、QQ等）
  const socialAccountRegex =
    /(?:微信|wechat|qq|QQ|微博|twitter|推特)\s*[:：]\s*[@\w\u4e00-\u9fa5\-_\.]+/gi;
  maskedContent = maskedContent.replace(socialAccountRegex, (match) => {
    return match.replace(/[:：]\s*[@\w\u4e00-\u9fa5\-_\.]+/, ': ****');
  });

  return maskedContent;
}

/**
 * 作者名称脱敏 - 防止真实姓名泄露
 */
export function maskAuthorName(name: string): string {
  if (!name || typeof name !== 'string') return name || 'Anonymous';

  // 如果已经是匿名或系统名称，直接返回
  if (name === 'Anonymous' || name === '当前用户' || name === 'System') {
    return name;
  }

  // 检查是否是中文姓名（2-4个字符）
  const isChineseName = /^[\u4e00-\u9fa5]{2,4}$/.test(name);
  if (isChineseName) {
    // 中文姓名：保留姓氏，名字用*替换
    return `${name.charAt(0)}${'*'.repeat(name.length - 1)}`;
  }

  // 检查是否是英文姓名（包含空格）
  const isEnglishName = /^[A-Za-z]+\s+[A-Za-z]+$/.test(name);
  if (isEnglishName) {
    const parts = name.split(/\s+/);
    if (parts.length >= 2) {
      // 英文姓名：保留首字母，其余用*替换
      return parts
        .map(
          (part) =>
            `${part.charAt(0)}${'*'.repeat(Math.max(part.length - 1, 1))}`,
        )
        .join(' ');
    }
  }

  // 其他情况：保留第一个字符，其余用*替换
  if (name.length > 1) {
    return `${name.charAt(0)}${'*'.repeat(Math.min(name.length - 1, 3))}`;
  }

  return name;
}
