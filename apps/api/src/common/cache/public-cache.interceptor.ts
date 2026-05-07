import { Injectable, ExecutionContext } from '@nestjs/common';
import { CacheInterceptor } from '@nestjs/cache-manager';

const IGNORED_QUERY = new Set(['__nocache', '_', 't']);

function normalizeHeader(v: unknown, fallback: string) {
  const val = v ?? fallback;
  return String(val)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
}

function serializeQuery(q: Record<string, any> | undefined) {
  if (!q) return '';
  const entries = Object.entries(q)
    .filter(([k]) => !IGNORED_QUERY.has(k))
    .map(([k, v]) => {
      const val = Array.isArray(v) ? v.join(',') : (v ?? '');
      return [k, String(val)];
    })
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return entries.join('&');
}

@Injectable()
export class PublicCacheInterceptor extends CacheInterceptor {
  trackBy(context: ExecutionContext): string | undefined {
    const req = context.switchToHttp().getRequest();

    // 仅缓存 GET/HEAD
    const method = String(req.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return undefined;

    // 调试绕过（query 或 header）
    if (
      req?.query?.__nocache === '1' ||
      req?.headers?.['x-debug-nocache'] === '1'
    ) {
      return undefined;
    }

    // 若带鉴权头，默认不缓存（避免个性化数据串缓存）
    if (req.headers?.authorization) return undefined;

    // 真实路径：Express 下推荐用 req.path（含全局前缀），route.path 可能是模板(:id)
    const path: string =
      req.path ||
      req.originalUrl?.split('?')[0] ||
      req.url?.split('?')[0] ||
      '/';

    // 跳过 SSE 端点（路径以 /stream 结尾），流式响应不应被缓存
    if (path.endsWith('/stream')) return undefined;

    // 稳定化 query
    const queryStr = serializeQuery(req.query);

    // 维度隔离
    const locale = normalizeHeader(req.headers['x-locale'], 'en');
    const platform = normalizeHeader(req.headers['x-platform'], 'h5');

    // 可读且可控的 key（建议加版本号，未来调整结构可平滑切换）
    const base = `v1|${method}|${path}${queryStr ? '?' + queryStr : ''}|${locale}|${platform}`;

    // 防止键过长：超过 512 时哈希一下
    if (base.length > 512) {
      const crypto = require('node:crypto');
      const digest = crypto.createHash('sha1').update(base).digest('hex');
      return `v1|${method}|${path}|${locale}|${platform}|h:${digest}`;
    }
    return base;
  }
}
