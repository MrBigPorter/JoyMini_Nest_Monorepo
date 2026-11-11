import { mergeKnowledgeMetadata } from './knowledge-metadata.util';

/**
 * #88 FR-4：合并规则的单元测试。
 *
 * 这些用例锁住的是「frontmatter > overrides > 默认值」这条优先级，
 * 一旦有人把它改回 overrides 优先，测试会立刻失败。
 */
describe('mergeKnowledgeMetadata', () => {
  it('.md：frontmatter 优先于用户填写（历史 bug 的回归点）', () => {
    const merged = mergeKnowledgeMetadata(
      {
        title: 'Size Guide',
        metadata: {
          domain: 'product',
          locale: 'en',
          contentType: 'reference',
          priority: 'P2',
        },
      },
      { domain: 'user', contentType: 'how-to', priority: 'P0' },
    );

    expect(merged.domain).toBe('product');
    expect(merged.contentType).toBe('reference');
    expect(merged.priority).toBe('P2');
  });

  it('.pdf：metadata 为空时全部回落到 overrides', () => {
    const merged = mergeKnowledgeMetadata(
      { title: 'Refund Policy (PDF)', metadata: {} },
      {
        domain: 'order',
        locale: 'en',
        contentType: 'policy',
        priority: 'P0',
        keywords: 'refund, return',
      },
    );

    expect(merged.domain).toBe('order');
    expect(merged.contentType).toBe('policy');
    expect(merged.priority).toBe('P0');
    expect(merged.keywords).toEqual(['refund', 'return']);
  });

  it('两者都没有时使用默认值', () => {
    const merged = mergeKnowledgeMetadata({ title: 'X', metadata: {} });

    expect(merged.domain).toBe('general');
    expect(merged.locale).toBe('en');
    expect(merged.contentType).toBe('policy');
    expect(merged.priority).toBe('P2');
    expect(merged.keywords).toEqual([]);
  });

  it('title 永远不拼接 "(domain)" 后缀', () => {
    const merged = mergeKnowledgeMetadata(
      { title: 'Account Guide', metadata: { domain: 'user' } },
      { domain: 'user' },
    );

    expect(merged.title).toBe('Account Guide');
    expect(merged.title).not.toContain('(');
  });

  it('keywords：frontmatter 数组优先于 overrides 字符串', () => {
    const merged = mergeKnowledgeMetadata(
      { title: 'X', metadata: { keywords: ['vip', 'membership'] } },
      { keywords: 'a, b, c' },
    );

    expect(merged.keywords).toEqual(['vip', 'membership']);
  });

  it('空字符串视为缺失，回落到下一优先级', () => {
    const merged = mergeKnowledgeMetadata(
      {
        title: 'X',
        metadata: { domain: '', contentType: '   ', locale: null },
      },
      { domain: 'wallet', contentType: 'faq' },
    );

    expect(merged.domain).toBe('wallet');
    expect(merged.contentType).toBe('faq');
    expect(merged.locale).toBe('en');
  });
});
