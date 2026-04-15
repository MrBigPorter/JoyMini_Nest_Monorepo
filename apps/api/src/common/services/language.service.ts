import { Injectable } from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class LanguageService {
  private readonly supportedLanguages = ['zh', 'en', 'ja', 'ko', 'fr', 'de'];
  private readonly defaultLanguage = 'zh';

  /**
   * 从请求中解析语言
   * 优先级：查询参数 > Accept-Language 头部 > 默认语言
   */
  resolveLanguage(req: Request): string {
    // 1. 查询参数
    const queryLang = req.query.lang as string;
    if (queryLang) {
      const normalized = this.normalizeLanguageCode(queryLang);
      if (this.isSupported(normalized)) return normalized;
    }

    // 2. Accept-Language 头部
    const acceptLanguage = req.headers['accept-language'];
    if (acceptLanguage) {
      const lang = this.parseAcceptLanguage(acceptLanguage);
      if (lang && this.isSupported(lang)) return lang;
    }

    // 3. 默认语言
    return this.defaultLanguage;
  }

  /**
   * 解析 Accept-Language 头部
   * 格式: "zh-CN,zh;q=0.9,en;q=0.8"
   */
  private parseAcceptLanguage(header: string): string | null {
    const languages = header.split(',');

    for (const lang of languages) {
      const [codeWithQ] = lang.split(';');
      const code = codeWithQ.trim();
      const normalized = this.normalizeLanguageCode(code);

      if (this.isSupported(normalized)) {
        return normalized;
      }
    }

    return null;
  }

  /**
   * 规范化语言代码
   * 将各种语言变体映射到标准代码
   */
  private normalizeLanguageCode(code: string): string {
    const mappings: Record<string, string> = {
      'zh-CN': 'zh',
      'zh-Hans': 'zh',
      'zh-Hant': 'zh', // 繁体中文也映射到简体
      'en-US': 'en',
      'en-GB': 'en',
      'en-CA': 'en',
      'ja-JP': 'ja',
      'ko-KR': 'ko',
      'fr-FR': 'fr',
      'de-DE': 'de',
      'es-ES': 'es',
    };
    // 移除地区后缀，如 zh-CN -> zh
    const baseCode = code.split('-')[0].toLowerCase();
    return mappings[code] || baseCode;
  }

  /**
   * 检查语言是否支持
   */
  private isSupported(lang: string): boolean {
    return this.supportedLanguages.includes(lang);
  }

  /**
   * 获取支持的语言列表
   */
  getSupportedLanguages(): string[] {
    return [...this.supportedLanguages];
  }

  /**
   * 获取默认语言
   */
  getDefaultLanguage(): string {
    return this.defaultLanguage;
  }

  /**
   * 验证语言代码是否有效
   */
  isValidLanguage(lang: string): boolean {
    const normalized = this.normalizeLanguageCode(lang);
    return this.isSupported(normalized);
  }
}
