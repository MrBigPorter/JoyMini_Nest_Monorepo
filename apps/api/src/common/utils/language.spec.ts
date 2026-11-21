import { detectLanguage, replyLanguageInstruction } from './language';

describe('language policy', () => {
  it('detects zh/en/mixed/unknown', () => {
    expect(detectLanguage('我的订单到哪了')).toBe('zh');
    expect(detectLanguage('Where is my order?')).toBe('en');
    expect(detectLanguage('我的 order 到哪了')).toBe('mixed');
    expect(detectLanguage('123 !!!')).toBe('unknown');
  });

  it('instruction follows the detected language', () => {
    expect(replyLanguageInstruction('你好')).toContain(
      'Reply in Simplified Chinese',
    );
    expect(replyLanguageInstruction('hello')).toContain('Reply in English');
    expect(replyLanguageInstruction('我的 order')).toContain(
      'dominant language',
    );
    expect(replyLanguageInstruction('')).toContain(
      "same language as the user's latest message",
    );
  });
});
