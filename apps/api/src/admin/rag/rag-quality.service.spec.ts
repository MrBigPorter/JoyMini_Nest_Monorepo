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
