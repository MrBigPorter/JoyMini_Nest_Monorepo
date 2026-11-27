import { RagQualityService } from './rag-quality.service';

function makeService() {
  return new RagQualityService({} as any);
}

describe('RagQualityService.checkTruncation', () => {
  it('Markdown 表格结尾不算截断', () => {
    const content = `${'x'.repeat(120)}\n| Tier | Gift |\n| Silver | Annually |`;

    const result = makeService().check(content, content.length);

    expect(result.flags).not.toContain('truncation');
    expect(result.overallScore).toBe(100);
  });

  it('列表结尾不算截断', () => {
    const content = `${'x'.repeat(120)}\n- Coupons and vouchers\n- Saved addresses`;

    const result = makeService().check(content, content.length);

    expect(result.flags).not.toContain('truncation');
  });

  it('表情符号在句号后不算截断', () => {
    const content = `${'x'.repeat(120)}\nWe're here to help! 🇵🇭`;

    const result = makeService().check(content, content.length);

    expect(result.flags).not.toContain('truncation');
  });

  it('真正没有结尾标点的长文本仍判截断', () => {
    const content = `${'x'.repeat(120)}\nThe refund policy says orders can be returned within`;

    const result = makeService().check(content, content.length);

    expect(result.flags).toContain('truncation');
  });

  it('正常句子结尾通过', () => {
    const content = `${'x'.repeat(120)}\nRefunds are available within 7 days.`;

    const result = makeService().check(content, content.length);

    expect(result.flags).not.toContain('truncation');
  });
});

describe('RagQualityService.check 通过判据', () => {
  it('passed 由四项检查决定，不用分档阈值替代', () => {
    // 10 字符：只有「空内容」检查不过，其余三项通过 → 75 分。
    // 旧实现按 overallScore>=75 判 passed，会把这个文档误判为通过。
    const result = makeService().check('a'.repeat(10), 10);

    expect(result.overallScore).toBe(75);
    expect(result.checks.emptyContent.passed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('四项全过时 passed 为 true，与分档同源', () => {
    const content = `${'x'.repeat(120)}\nRefunds are available within 7 days.`;

    const result = makeService().check(content, content.length);

    expect(result.overallScore).toBe(100);
    expect(Object.values(result.checks).every((c) => c.passed)).toBe(true);
    expect(result.passed).toBe(true);
  });
});
