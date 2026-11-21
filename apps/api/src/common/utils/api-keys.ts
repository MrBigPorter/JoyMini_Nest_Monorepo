/**
 * API key 列表解析：支持 `key1,key2,key3` 这种轮换写法。
 *
 * 不记录、不打印 key 本身；调用方只拿数组。
 */
export function parseApiKeys(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const part of raw.split(',')) {
    const key = part.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

export function firstApiKey(raw: string | null | undefined): string {
  return parseApiKeys(raw)[0] ?? '';
}
