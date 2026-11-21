import { firstApiKey, parseApiKeys } from './api-keys';

describe('parseApiKeys', () => {
  it('解析逗号分隔、去空白、去重', () => {
    expect(parseApiKeys(' a , b ,, a , c ')).toEqual(['a', 'b', 'c']);
  });

  it('空值返回空数组', () => {
    expect(parseApiKeys('')).toEqual([]);
    expect(parseApiKeys(null)).toEqual([]);
    expect(parseApiKeys(undefined)).toEqual([]);
  });

  it('firstApiKey 返回第一把', () => {
    expect(firstApiKey('a,b')).toBe('a');
    expect(firstApiKey('')).toBe('');
  });
});
