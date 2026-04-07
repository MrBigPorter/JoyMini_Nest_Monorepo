import { Injectable, PipeTransform, ArgumentMetadata } from '@nestjs/common';
import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('');
// @ts-ignore: jsdom window is compatible enough for DOMPurify
const purify = DOMPurify(window);

/**
 *
 * XSS 内容净化管道
 * 自动净化所有字符串类型的请求参数
 * 移除危险的HTML标签和脚本，保留安全格式
 */
@Injectable()
export class XssSanitizePipe implements PipeTransform {
  transform(value: any, metadata: ArgumentMetadata) {
    return this.sanitizeValue(value);
  }

  private sanitizeValue(value: any): any {
    if (typeof value === 'string') {
      return purify
        .sanitize(value, {
          ALLOWED_TAGS: [
            'b',
            'i',
            'em',
            'strong',
            'a',
            'br',
            'p',
            'ul',
            'ol',
            'li',
          ],
          ALLOWED_ATTR: ['href', 'target', 'rel'],
          ALLOW_DATA_ATTR: false,
          FORBID_TAGS: ['script', 'style', 'iframe', 'form', 'input', 'button'],
          FORBID_ATTR: ['onload', 'onerror', 'onclick', 'style', 'class'],
        })
        .trim();
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeValue(item));
    }

    if (value !== null && typeof value === 'object') {
      const sanitized: Record<string, any> = {};
      for (const key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          sanitized[key] = this.sanitizeValue(value[key]);
        }
      }
      return sanitized;
    }

    return value;
  }
}
