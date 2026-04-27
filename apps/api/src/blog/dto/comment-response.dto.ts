import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose, Transform, Type } from 'class-transformer';
import { MaskString } from '@api/common/dto/transforms';

/**
 * 评论内容脱敏工具函数
 * 用于处理评论内容中的敏感信息
 */
function maskCommentContent(content: string): string {
  if (!content || typeof content !== 'string') return content || '';

  let maskedContent = content;

  // 1. 邮箱地址脱敏
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  maskedContent = maskedContent.replace(emailRegex, (match) => {
    const [localPart, domain] = match.split('@');
    if (!localPart || !domain) return match;

    if (localPart.length <= 2) {
      return `${localPart.charAt(0)}***@${domain}`;
    }

    const maskedLocal =
      localPart.charAt(0) + '*'.repeat(Math.min(localPart.length - 1, 4));
    return `${maskedLocal}@${domain}`;
  });

  // 2. 手机号码脱敏（中国格式）
  const phoneRegex = /\b1[3-9]\d{9}\b/g;
  maskedContent = maskedContent.replace(phoneRegex, (match) => {
    return match.replace(/^(\d{3})\d+(\d{4})$/, '$1****$2');
  });

  // 3. 身份证号脱敏
  const idCardRegex = /\b\d{15}\b|\b\d{17}[\dXx]\b/g;
  maskedContent = maskedContent.replace(idCardRegex, (match) => {
    return match.replace(/^(\w{6})\w+(\w{4})$/, '$1********$2');
  });

  // 4. 银行卡号脱敏
  const bankCardRegex = /\b\d{16,19}\b/g;
  maskedContent = maskedContent.replace(bankCardRegex, (match) => {
    if (match.length < 8) return match;
    const prefix = match.slice(0, 6);
    const suffix = match.slice(-4);
    const maskLength = match.length - 10;
    return `${prefix}${'*'.repeat(Math.max(maskLength, 1))}${suffix}`;
  });

  // 5. 防止社交账号泄露
  const socialAccountRegex =
    /(?:微信|wechat|qq|QQ|微博|twitter|推特)\s*[:：]\s*[@\w\u4e00-\u9fa5\-_.]+/gi;
  maskedContent = maskedContent.replace(socialAccountRegex, (match) => {
    return match.replace(/[:：]\s*[@\w\u4e00-\u9fa5\-_.]+/, ': ****');
  });

  // 6. 防止密码/令牌泄露
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
    maskedContent = maskedContent.replace(regex, (match) => {
      return match.replace(/[:=]\s*['"]?[^'"\s]+['"]?/, ': ********');
    });
  });

  return maskedContent;
}

/**
 * 单个评论响应DTO
 */
export class CommentResponseDto {
  @ApiProperty({ description: '评论ID' })
  @Expose()
  id!: string;

  @ApiProperty({ description: '文章ID' })
  @Expose()
  articleId!: string;

  @ApiProperty({ description: '作者名称（已脱敏）' })
  @Expose()
  @Transform(({ value }) => {
    if (!value || typeof value !== 'string') return 'Anonymous';

    // 使用现有的MaskString逻辑
    if (value === 'Anonymous' || value === '当前用户' || value === 'System') {
      return value;
    }

    // 情况A: 只有一个字
    if (value.length <= 1) {
      return '*';
    }

    // 情况B: 两个字
    if (value.length === 2) {
      return `${value[0]}*`;
    }

    // 情况C: 三个字及以上
    // 规则: 保留首尾，中间最多显示3个星号
    const maskLen = Math.min(3, value.length - 2);
    return `${value[0]}${'*'.repeat(maskLen)}${value[value.length - 1]}`;
  })
  author!: string;

  @ApiPropertyOptional({ description: '作者邮箱（已脱敏）' })
  @Expose()
  @Transform(({ value }) => {
    if (!value || typeof value !== 'string') return null;

    const [localPart, domain] = value.split('@');
    if (!localPart || !domain) return value;

    if (localPart.length <= 2) {
      return `${localPart.charAt(0)}***@${domain}`;
    }

    return `${localPart.slice(0, 2)}***${localPart.slice(-1)}@${domain}`;
  })
  email!: string | null;

  @ApiPropertyOptional({ description: '作者网站' })
  @Expose()
  website!: string | null;

  @ApiProperty({ description: '评论内容（已脱敏）' })
  @Expose()
  @Transform(({ value }) => maskCommentContent(value || ''))
  content!: string;

  @ApiPropertyOptional({ description: '父评论ID' })
  @Expose()
  parentId!: string | null;

  @ApiProperty({ description: '是否已审核通过' })
  @Expose()
  @Transform(({ value }) => value === 'APPROVED')
  approved!: boolean;

  @ApiProperty({ description: '点赞数' })
  @Expose()
  likes!: number;

  @ApiProperty({ description: '创建时间' })
  @Expose()
  createdAt!: string;

  @ApiProperty({ description: '更新时间' })
  @Expose()
  updatedAt!: string;

  @ApiPropertyOptional({
    description: '子评论列表',
    type: () => [CommentResponseDto],
  })
  @Expose()
  @Type(() => CommentResponseDto)
  children?: CommentResponseDto[];
}

/**
 * 评论列表响应DTO
 */
export class CommentListResponseDto {
  @ApiProperty({
    description: '评论列表',
    type: () => [CommentResponseDto],
  })
  @Expose()
  @Type(() => CommentResponseDto)
  items!: CommentResponseDto[];

  @ApiProperty({ description: '评论总数' })
  @Expose()
  total!: number;

  @ApiProperty({ description: '当前页码' })
  @Expose()
  page!: number;

  @ApiProperty({ description: '每页大小' })
  @Expose()
  pageSize!: number;

  @ApiProperty({ description: '总页数' })
  @Expose()
  totalPages!: number;
}
