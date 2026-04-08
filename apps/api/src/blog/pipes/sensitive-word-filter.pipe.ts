import {
  Injectable,
  PipeTransform,
  ArgumentMetadata,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
// @ts-ignore
import AhoCorasick from 'ahocorasick';

/**
 * 敏感词级别
 */
export enum SensitiveWordLevel {
  LOW = 1, // 轻微 - 自动替换屏蔽
  MEDIUM = 2, // 中等 - 进入审核队列
  HIGH = 3, // 严重 - 直接拦截
}

/**
 * 敏感词匹配结果
 */
export interface SensitiveWordMatch {
  word: string;
  level: SensitiveWordLevel;
  start: number;
  end: number;
}

/**
 * 敏感词过滤管道
 * 基于AC自动机多模式匹配算法
 * 支持三级敏感词分级处理
 */
@Injectable()
export class SensitiveWordFilterPipe implements PipeTransform {
  private static ac: AhoCorasick;
  private static wordMap: Map<string, SensitiveWordLevel>;
  private static lastUpdate: number;

  constructor() {
    // 初始化敏感词库
    this.initializeWordLibrary();
  }

  /**
   * 初始化敏感词库
   */
  private initializeWordLibrary() {
    // 内置基础敏感词库
    const sensitiveWords: Array<{ word: string; level: SensitiveWordLevel }> = [
      // 🔴 严重违禁词
      { word: '违禁词1', level: SensitiveWordLevel.HIGH },
      { word: '违禁词2', level: SensitiveWordLevel.HIGH },

      // 🟠 中等广告/垃圾词
      { word: '加微信', level: SensitiveWordLevel.MEDIUM },
      { word: '联系电话', level: SensitiveWordLevel.MEDIUM },
      { word: '广告推广', level: SensitiveWordLevel.MEDIUM },

      // 🟡 轻微不文明用语
      { word: '脏话1', level: SensitiveWordLevel.LOW },
      { word: '脏话2', level: SensitiveWordLevel.LOW },
    ];

    SensitiveWordFilterPipe.wordMap = new Map();
    const words: string[] = [];

    sensitiveWords.forEach((item) => {
      words.push(item.word);
      SensitiveWordFilterPipe.wordMap.set(item.word.toLowerCase(), item.level);
    });

    // 构建AC自动机
    SensitiveWordFilterPipe.ac = new AhoCorasick(words);
    SensitiveWordFilterPipe.lastUpdate = Date.now();
  }

  transform(value: any, metadata: ArgumentMetadata) {
    return this.filterValue(value);
  }

  private filterValue(value: any): any {
    if (typeof value === 'string') {
      return this.filterText(value);
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.filterValue(item));
    }

    if (value !== null && typeof value === 'object') {
      const filtered: Record<string, any> = {};
      for (const key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          filtered[key] = this.filterValue(value[key]);
        }
      }
      return filtered;
    }

    return value;
  }

  /**
   * 过滤文本内容
   */
  private filterText(text: string): string {
    if (!text || text.length === 0) {
      return text;
    }

    const matches = this.searchSensitiveWords(text);

    if (matches.length === 0) {
      return text;
    }

    // 检查是否有严重违禁词
    const hasHighLevel = matches.some(
      (m) => m.level === SensitiveWordLevel.HIGH,
    );
    if (hasHighLevel) {
      throw new HttpException(
        '内容包含违规信息，无法发布',
        HttpStatus.BAD_REQUEST,
      );
    }

    // 检查是否有中等敏感词，标记需要审核
    const hasMediumLevel = matches.some(
      (m) => m.level === SensitiveWordLevel.MEDIUM,
    );
    if (hasMediumLevel) {
      // TODO: 标记评论进入审核队列
      // 这里可以注入上下文或者设置请求标记
    }

    // 替换轻微敏感词
    return this.replaceSensitiveWords(text, matches);
  }

  /**
   * 搜索敏感词匹配
   */
  private searchSensitiveWords(text: string): SensitiveWordMatch[] {
    const lowerText = text.toLowerCase();
    const results = SensitiveWordFilterPipe.ac.search(lowerText);
    const matches: SensitiveWordMatch[] = [];

    for (const result of results) {
      const endIndex = result[0];
      const words = result[1];

      for (const word of words) {
        const startIndex = endIndex - word.length + 1;
        const level =
          SensitiveWordFilterPipe.wordMap.get(word.toLowerCase()) ||
          SensitiveWordLevel.LOW;

        matches.push({
          word,
          level,
          start: startIndex,
          end: endIndex,
        });
      }
    }

    return matches;
  }

  /**
   * 替换敏感词为 ***
   */
  private replaceSensitiveWords(
    text: string,
    matches: SensitiveWordMatch[],
  ): string {
    // 按起始位置排序
    matches.sort((a, b) => a.start - b.start);

    let result = '';
    let lastIndex = 0;

    for (const match of matches) {
      if (match.start >= lastIndex) {
        result += text.substring(lastIndex, match.start);
        result += '*'.repeat(match.word.length);
        lastIndex = match.end + 1;
      }
    }

    if (lastIndex < text.length) {
      result += text.substring(lastIndex);
    }

    return result;
  }
}
