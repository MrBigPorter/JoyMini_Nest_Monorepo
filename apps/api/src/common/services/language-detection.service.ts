import { Injectable } from '@nestjs/common';

@Injectable()
export class LanguageDetectionService {
  private readonly supportedLanguages = ['zh', 'en', 'ja', 'ko', 'fr', 'de'];

  // 语言代码映射表 (ISO 639-3 → ISO 639-1)
  private readonly languageMap: Record<string, string> = {
    cmn: 'zh', // 中文
    eng: 'en', // 英文
    jpn: 'ja', // 日文
    kor: 'ko', // 韩文
    fra: 'fr', // 法文
    deu: 'de', // 德文
    spa: 'es', // 西班牙文（备用）
    ita: 'it', // 意大利文（备用）
    rus: 'ru', // 俄文（备用）
  };

  /**
   * 检测文本的语言
   * 混合检测策略：字符集检测为主，franc-min为辅
   */
  detectLanguage(text: string): { language: string; confidence: number } {
    if (!text || text.trim().length === 0) {
      return { language: 'unknown', confidence: 0 };
    }

    // 1. 对于短文本（<10字符），主要使用字符集检测
    if (text.length < 10) {
      return this.fallbackDetection(text);
    }

    // 2. 对于长文本，尝试使用franc-min（如果可用）
    try {
      // 动态导入franc-min，避免编译错误
      const franc = require('franc-min');
      const francResult = franc.franc(text);

      // 如果franc检测成功且置信度高，使用映射结果
      if (francResult !== 'und' && this.languageMap[francResult]) {
        const mappedLanguage = this.languageMap[francResult];

        // 检查是否是我们支持的语言
        if (this.supportedLanguages.includes(mappedLanguage)) {
          // franc-min对长文本更准确，置信度设为0.85
          return { language: mappedLanguage, confidence: 0.85 };
        }
      }
    } catch (error) {
      // franc-min不可用，继续使用字符集检测
    }

    // 3. 回退到字符集检测（作为备用方案）
    return this.fallbackDetection(text);
  }

  /**
   * 回退检测：基于字符集的特征检测
   * 当franc-min无法检测时使用
   */
  private fallbackDetection(text: string): {
    language: string;
    confidence: number;
  } {
    const scores: Record<string, number> = {};

    // 分析文本中的字符特征
    for (const char of text) {
      const code = char.charCodeAt(0);

      // 中文检测 (CJK统一表意文字)
      if (
        (code >= 0x4e00 && code <= 0x9fff) || // 基本CJK
        (code >= 0x3400 && code <= 0x4dbf)
      ) {
        // 扩展A
        scores['zh'] = (scores['zh'] || 0) + 1;
      }

      // 日文检测 (平假名、片假名)
      else if (
        (code >= 0x3040 && code <= 0x309f) || // 平假名
        (code >= 0x30a0 && code <= 0x30ff)
      ) {
        // 片假名
        scores['ja'] = (scores['ja'] || 0) + 1;
      }

      // 韩文检测 (谚文)
      else if (code >= 0xac00 && code <= 0xd7af) {
        scores['ko'] = (scores['ko'] || 0) + 1;
      }

      // 拉丁字母检测 (英文、法文、德文等)
      else if (
        (code >= 0x0041 && code <= 0x005a) || // A-Z
        (code >= 0x0061 && code <= 0x007a) || // a-z
        (code >= 0x00c0 && code <= 0x00ff)
      ) {
        // 带重音的拉丁字母
        // 需要进一步区分英文、法文、德文
        if (this.isFrenchCharacter(char)) {
          scores['fr'] = (scores['fr'] || 0) + 1;
        } else if (this.isGermanCharacter(char)) {
          scores['de'] = (scores['de'] || 0) + 1;
        } else {
          scores['en'] = (scores['en'] || 0) + 1;
        }
      }
    }

    // 如果没有检测到特定字符，使用启发式规则
    if (Object.keys(scores).length === 0) {
      // 检查是否主要是ASCII字符
      const asciiRatio = this.calculateAsciiRatio(text);
      if (asciiRatio > 0.8) {
        return { language: 'en', confidence: 0.7 };
      }
      return { language: 'unknown', confidence: 0 };
    }

    // 处理混合语言的情况
    // 如果检测到中文和英文混合，根据比例判断
    if (scores['zh'] && scores['en']) {
      const zhRatio = scores['zh'] / (scores['zh'] + scores['en']);
      if (zhRatio > 0.2) {
        // 中文占主导（阈值降低到20%，因为技术术语多是英文）
        return { language: 'zh', confidence: zhRatio };
      } else {
        // 英文占主导
        return { language: 'en', confidence: 1 - zhRatio };
      }
    }

    // 处理日文和英文混合
    if (scores['ja'] && scores['en']) {
      const jaRatio = scores['ja'] / (scores['ja'] + scores['en']);
      if (jaRatio > 0.3) {
        // 日文占主导
        return { language: 'ja', confidence: jaRatio };
      } else {
        // 英文占主导
        return { language: 'en', confidence: 1 - jaRatio };
      }
    }

    // 处理韩文和英文混合
    if (scores['ko'] && scores['en']) {
      const koRatio = scores['ko'] / (scores['ko'] + scores['en']);
      if (koRatio > 0.3) {
        // 韩文占主导
        return { language: 'ko', confidence: koRatio };
      } else {
        // 英文占主导
        return { language: 'en', confidence: 1 - koRatio };
      }
    }

    // 处理法文和德文的特殊情况
    // 如果文本中包含法文特有字符或法文词汇，优先判断为法文
    if ((scores['fr'] && scores['fr'] > 0) || this.containsFrenchWords(text)) {
      return {
        language: 'fr',
        confidence: Math.min(1.0, (scores['fr'] || 0) / text.length + 0.3),
      };
    }

    // 如果文本中包含德文特有字符或德文词汇，优先判断为德文
    if ((scores['de'] && scores['de'] > 0) || this.containsGermanWords(text)) {
      return {
        language: 'de',
        confidence: Math.min(1.0, (scores['de'] || 0) / text.length + 0.3),
      };
    }

    // 找到得分最高的语言
    let detectedLanguage = 'unknown';
    let maxScore = 0;
    let totalScore = 0;

    for (const [lang, score] of Object.entries(scores)) {
      totalScore += score;
      if (score > maxScore) {
        maxScore = score;
        detectedLanguage = lang;
      }
    }

    const confidence = totalScore > 0 ? maxScore / totalScore : 0;
    return { language: detectedLanguage, confidence };
  }

  /**
   * 检查翻译完整性
   * 比较源文本和目标文本的长度和内容
   */
  checkTranslationCompleteness(
    sourceText: string,
    targetText: string,
    targetLanguage: string,
  ): { completeness: number; issues: string[] } {
    const issues: string[] = [];

    if (!sourceText || sourceText.trim().length === 0) {
      return { completeness: 100, issues: ['源文本为空'] };
    }

    if (!targetText || targetText.trim().length === 0) {
      return { completeness: 0, issues: ['目标文本为空'] };
    }

    const sourceLength = sourceText.length;
    const targetLength = targetText.length;

    // 不同语言的预期长度比例
    const expectedRatios: Record<string, number> = {
      zh: 1.0, // 中文 -> 英文通常更长
      en: 1.5, // 英文通常比中文长50%
      ja: 1.2, // 日文比中文稍长
      ko: 1.1, // 韩文与中文长度相近
      fr: 1.6, // 法文通常更长
      de: 1.7, // 德文通常更长
    };

    const expectedRatio = expectedRatios[targetLanguage] || 1.5;
    const actualRatio = targetLength / sourceLength;

    let completeness = 100;

    // 检查长度比例
    if (actualRatio < expectedRatio * 0.3) {
      issues.push(
        `翻译过短：预期比例 ${expectedRatio.toFixed(1)}，实际比例 ${actualRatio.toFixed(1)}`,
      );
      completeness = Math.max(
        0,
        Math.round((actualRatio / (expectedRatio * 0.3)) * 100),
      );
    } else if (actualRatio > expectedRatio * 2) {
      issues.push(
        `翻译过长：预期比例 ${expectedRatio.toFixed(1)}，实际比例 ${actualRatio.toFixed(1)}`,
      );
      completeness = 100; // 过长不算不完整
    }

    // 检查残留字符
    const residualChars = this.detectResidualCharacters(
      'zh',
      targetText,
      targetLanguage,
    );
    if (residualChars.length > 0) {
      issues.push(`检测到残留字符：${residualChars.join(', ')}`);
      completeness = Math.max(0, completeness - residualChars.length * 10);
    }

    // 检查是否与源文本完全相同
    if (sourceText === targetText) {
      issues.push('目标文本与源文本完全相同，可能未翻译');
      completeness = 0;
    }

    return { completeness: Math.max(0, Math.min(100, completeness)), issues };
  }

  /**
   * 检测残留字符
   * 检查目标文本中是否包含源语言的字符
   */
  detectResidualCharacters(
    sourceLanguage: string,
    targetText: string,
    targetLanguage: string,
  ): string[] {
    const residualChars: string[] = [];

    if (!targetText) {
      return residualChars;
    }

    // 源语言字符检测规则
    const sourceLanguagePatterns: Record<string, RegExp> = {
      zh: /[\u4e00-\u9fff\u3400-\u4dbf]/g, // 中文字符
      ja: /[\u3040-\u309f\u30a0-\u30ff]/g, // 日文字符
      ko: /[\uac00-\ud7af]/g, // 韩文字符
    };

    const pattern = sourceLanguagePatterns[sourceLanguage];
    if (pattern) {
      const matches = targetText.match(pattern);
      if (matches) {
        // 去重并限制数量
        const uniqueChars = [...new Set(matches)].slice(0, 5);
        residualChars.push(...uniqueChars);
      }
    }

    return residualChars;
  }

  /**
   * 检查字段是否已翻译
   * 更智能的检测，避免误判
   */
  isFieldTranslated(
    sourceValue: string | undefined,
    targetValue: string | undefined,
    targetLanguage: string,
  ): { translated: boolean; confidence: number; reason?: string } {
    // 如果目标值为空或未定义，肯定未翻译
    if (!targetValue || targetValue.trim().length === 0) {
      return { translated: false, confidence: 1.0, reason: '目标字段为空' };
    }

    // 如果源值为空，无法判断
    if (!sourceValue || sourceValue.trim().length === 0) {
      return {
        translated: true,
        confidence: 0.5,
        reason: '源字段为空，无法准确判断',
      };
    }

    // 检查是否与源文本完全相同
    if (sourceValue === targetValue) {
      // 特殊情况：如果源文本是英文（不包含中文字符），且目标语言也是英文，那么相同是正常的
      const sourceDetection = this.detectLanguage(sourceValue);
      const chineseCharsRegex = /[\u4e00-\u9fa5]/;

      if (
        sourceDetection.language === 'en' &&
        targetLanguage === 'en' &&
        !chineseCharsRegex.test(sourceValue)
      ) {
        return {
          translated: true,
          confidence: 1.0,
          reason: '英文标签，与源文本相同是正常的',
        };
      }

      return { translated: false, confidence: 0.9, reason: '与源文本完全相同' };
    }

    // 检查长度比例
    const sourceLength = sourceValue.length;
    const targetLength = targetValue.length;

    // 不同语言的合理长度范围
    const minRatios: Record<string, number> = {
      en: 0.5, // 英文至少是中文的50%
      ja: 0.4,
      ko: 0.4,
      fr: 0.6,
      de: 0.7,
    };

    const minRatio = minRatios[targetLanguage] || 0.3;
    const ratio = targetLength / sourceLength;

    if (ratio < minRatio) {
      return {
        translated: false,
        confidence: 0.8,
        reason: `翻译过短：比例 ${ratio.toFixed(2)} 低于最小值 ${minRatio}`,
      };
    }

    // 额外检查：对于中文到英文的翻译，如果目标文本太短（少于3个字符），可能不完整
    const sourceDetection = this.detectLanguage(sourceValue);
    if (
      sourceDetection.language === 'zh' &&
      targetLanguage === 'en' &&
      targetLength < 3
    ) {
      return {
        translated: false,
        confidence: 0.9,
        reason: '翻译过短：中文到英文的翻译至少需要3个字符',
      };
    }

    // 检测语言
    const detection = this.detectLanguage(targetValue);
    if (detection.language === targetLanguage && detection.confidence > 0.7) {
      return {
        translated: true,
        confidence: detection.confidence,
        reason: '检测到目标语言字符',
      };
    }

    // 默认认为已翻译，但置信度较低
    return {
      translated: true,
      confidence: 0.6,
      reason: '无法确定，但内容非空且与源文本不同',
    };
  }

  /**
   * 获取支持的语言列表
   */
  getSupportedLanguages(): string[] {
    return [...this.supportedLanguages];
  }

  /**
   * 检查语言是否支持
   */
  isLanguageSupported(language: string): boolean {
    return this.supportedLanguages.includes(language);
  }

  // 私有辅助方法
  private isFrenchCharacter(char: string): boolean {
    // 法文特有字符：é, è, ê, ë, à, â, ç, î, ï, ô, ù, û, ü, ÿ
    // 还包括法文常用的重音字符
    const frenchChars = /[éèêëàâçîïôùûüÿœæ]/i;
    return frenchChars.test(char);
  }

  private isGermanCharacter(char: string): boolean {
    // 德文特有字符：ä, ö, ü, ß
    const germanChars = /[äöüß]/i;
    return germanChars.test(char);
  }

  /**
   * 检测文本是否包含法文特有词汇
   */
  private containsFrenchWords(text: string): boolean {
    const frenchWords = [
      'le',
      'la',
      'les',
      'un',
      'une',
      'des',
      'et',
      'est',
      'dans',
      'pour',
      'avec',
      'sur',
      'par',
      'bonjour',
      'monde',
      'merci',
      "s'il",
      'vous',
      'nous',
      'je',
      'tu',
      'il',
      'elle',
      'ils',
      'elles',
      'oui',
      'non',
      'mais',
    ];

    const lowerText = text.toLowerCase();
    return frenchWords.some((word) =>
      new RegExp(`\\b${word}\\b`, 'i').test(lowerText),
    );
  }

  /**
   * 检测文本是否包含德文特有词汇
   */
  private containsGermanWords(text: string): boolean {
    const germanWords = [
      'der',
      'die',
      'das',
      'und',
      'ist',
      'nicht',
      'mit',
      'von',
      'auf',
      'für',
      'wir',
      'sie',
      'ich',
      'du',
      'er',
      'es',
      'hallo',
      'welt',
      'bitte',
      'danke',
      'guten',
      'tag',
      'morgen',
      'abend',
      'nacht',
      'ja',
      'nein',
      'oder',
      'aber',
    ];

    const lowerText = text.toLowerCase();
    return germanWords.some((word) =>
      new RegExp(`\\b${word}\\b`, 'i').test(lowerText),
    );
  }

  private calculateAsciiRatio(text: string): number {
    if (!text) return 0;

    let asciiCount = 0;
    for (const char of text) {
      const code = char.charCodeAt(0);
      if (code <= 0x7f) {
        // ASCII范围
        asciiCount++;
      }
    }

    return asciiCount / text.length;
  }
}
