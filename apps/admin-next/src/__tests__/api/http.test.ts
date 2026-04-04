import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  vi,
} from 'vitest';

import { http as mswHttp, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import {
  SENTRY_SPAN_ATTR_KEY,
  SENTRY_SPAN_NAME,
  SENTRY_SPAN_OP,
} from '@/lib/sentry-span-constants';

// ── mock stores ──────────────────────────────────────────────────
const mockAddToast = vi.fn();
const { startSpanMock } = vi.hoisted(() => ({
  startSpanMock: vi.fn(),
}));
vi.mock('@/store/useToastStore', () => ({
  useToastStore: { getState: () => ({ addToast: mockAddToast }) },
}));
vi.mock('@sentry/nextjs', () => ({
  startSpan: startSpanMock,
}));

// ── import HttpClient after mocks ────────────────────────────────
import { http } from '@/api/http';

// ── MSW server — 拦截真实网络层，与哪个 axios 实例无关 ─────────────
const server = setupServer();
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
  startSpanMock.mockImplementation(async (_options, callback) => callback());
});
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers();
  mockAddToast.mockClear();
  startSpanMock.mockClear();
  startSpanMock.mockImplementation(async (_options, callback) => callback());
  localStorage.clear();
  // Must use a valid absolute URL as the base so that MSW's
  // toAbsoluteUrl(url, window.location.href) can resolve relative paths.
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { pathname: '/', href: 'http://localhost/' },
  });
});

// ── 辅助：注册单次响应 ─────────────────────────────────────────────
function mockGet(path: string, body: object, status = 200) {
  server.use(mswHttp.get(path, () => HttpResponse.json(body, { status })));
}
function mockPost(path: string, body: object, status = 200) {
  server.use(mswHttp.post(path, () => HttpResponse.json(body, { status })));
}

// ═══════════════════════════════════════════════════════════════
// 基础
// ═══════════════════════════════════════════════════════════════
describe('http client — 基础', () => {
  it('实例存在', () => expect(http).toBeDefined());

  it('公共方法全部存在', () => {
    const httpRecord = http as unknown as Record<string, unknown>;
    ['get', 'post', 'put', 'patch', 'delete', 'upload', 'download'].forEach(
      (m) => expect(typeof httpRecord[m]).toBe('function'),
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 成功响应
// ═══════════════════════════════════════════════════════════════
describe('http client — 成功响应', () => {
  it('GET 返回 data 字段', async () => {
    mockGet('http://localhost/api/users', {
      code: 10000,
      message: 'ok',
      data: [{ id: 1 }],
    });
    expect(await http.get('/users')).toEqual([{ id: 1 }]);
    expect(startSpanMock).toHaveBeenCalledWith(
      {
        name: SENTRY_SPAN_NAME.HTTP_CLIENT_REQUEST,
        op: SENTRY_SPAN_OP.HTTP_CLIENT,
        attributes: {
          [SENTRY_SPAN_ATTR_KEY.HTTP_METHOD]: 'GET',
          [SENTRY_SPAN_ATTR_KEY.HTTP_ROUTE]: '/users',
        },
      },
      expect.any(Function),
    );
  });

  it('trace=false 时不创建 span', async () => {
    mockGet('http://localhost/api/no-trace', {
      code: 10000,
      message: 'ok',
      data: { ok: true },
    });

    expect(await http.get('/no-trace', undefined, { trace: false })).toEqual({
      ok: true,
    });
    expect(startSpanMock).not.toHaveBeenCalled();
  });

  it('支持自定义 span 名称并合并自定义 attributes', async () => {
    mockGet('http://localhost/api/custom-trace', {
      code: 10000,
      message: 'ok',
      data: { ok: true },
    });

    await http.get('/custom-trace', undefined, {
      trace: {
        name: 'admin.http.custom_trace',
        attributes: {
          feature: 'settings',
          action: 'load',
        },
      },
    });

    expect(startSpanMock).toHaveBeenCalledWith(
      {
        name: 'admin.http.custom_trace',
        op: SENTRY_SPAN_OP.HTTP_CLIENT,
        attributes: {
          [SENTRY_SPAN_ATTR_KEY.HTTP_METHOD]: 'GET',
          [SENTRY_SPAN_ATTR_KEY.HTTP_ROUTE]: '/custom-trace',
          feature: 'settings',
          action: 'load',
        },
      },
      expect.any(Function),
    );
  });

  it('POST 返回 data 字段', async () => {
    mockPost('http://localhost/api/users', {
      code: 10000,
      message: 'ok',
      data: { id: 2 },
    });
    expect(await http.post('/users', { name: 'Bob' })).toEqual({ id: 2 });
  });

  it('code=200 也视为成功', async () => {
    mockGet('http://localhost/api/ping', {
      code: 200,
      message: 'ok',
      data: 'pong',
    });
    expect(await http.get('/ping')).toBe('pong');
  });

  it('并发重复 GET 时复用同一个进行中请求', async () => {
    let hitCount = 0;
    server.use(
      mswHttp.get('http://localhost/api/shared', async () => {
        hitCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return HttpResponse.json({
          code: 10000,
          message: 'ok',
          data: { id: 1 },
        });
      }),
    );

    const [first, second] = await Promise.all([
      http.get('/shared'),
      http.get('/shared'),
    ]);

    expect(first).toEqual({ id: 1 });
    expect(second).toEqual({ id: 1 });
    expect(hitCount).toBe(1);
    expect(startSpanMock).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// 业务错误
// ═══════════════════════════════════════════════════════════════
describe('http client — 业务错误', () => {
  it('非 200/10000 code 时抛出并显示 toast', async () => {
    mockGet('http://localhost/api/forbidden', {
      code: 403,
      message: '没有权限',
      data: null,
    });
    await expect(http.get('/forbidden')).rejects.toBeDefined();
    expect(mockAddToast).toHaveBeenCalledWith('error', '没有权限');
  });

  it('业务 code=401 时清除 token 并跳转 /login', async () => {
    localStorage.setItem('auth_token', 'old-token');
    server.use(
      mswHttp.get('http://localhost/api/secret', () =>
        HttpResponse.json({ code: 401, message: '未授权', data: null }),
      ),
      // handleUnauthorized 现在 await clear-cookie 后才跳转
      mswHttp.post('http://localhost/api/v1/auth/admin/clear-cookie', () =>
        HttpResponse.json({ code: 10000, message: 'ok', data: { ok: true } }),
      ),
    );
    await expect(http.get('/secret')).rejects.toBeDefined();
    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(window.location.href).toBe('/login');
  });

  it('refresh 成功但重试后仍返回业务 401 — 不应无限循环，只登出一次', async () => {
    localStorage.setItem('auth_token', 'expired-token');
    localStorage.setItem('refresh_token', 'refresh-token-x');

    let refreshCount = 0;
    server.use(
      // 原始请求与重试请求都返回业务 401
      mswHttp.get('http://localhost/api/always-401', () =>
        HttpResponse.json({ code: 401, message: '业务权限不足', data: null }),
      ),
      mswHttp.post('http://localhost/api/v1/auth/admin/refresh', () => {
        refreshCount += 1;
        return HttpResponse.json({
          code: 10000,
          message: 'ok',
          data: {
            tokens: {
              accessToken: 'new-access-token',
              refreshToken: 'new-refresh-token',
            },
          },
        });
      }),
      mswHttp.post('http://localhost/api/v1/auth/admin/set-cookie', () =>
        HttpResponse.json({ code: 10000, message: 'ok', data: { ok: true } }),
      ),
      mswHttp.post('http://localhost/api/v1/auth/admin/clear-cookie', () =>
        HttpResponse.json({ code: 10000, message: 'ok', data: { ok: true } }),
      ),
    );

    await expect(http.get('/always-401')).rejects.toBeDefined();
    // refresh 只触发一次，不循环
    expect(refreshCount).toBe(1);
    // 最终触发登出
    expect(window.location.href).toBe('/login');
  });
});

// ═══════════════════════════════════════════════════════════════
// HTTP 错误
// ═══════════════════════════════════════════════════════════════
describe('http client — HTTP 错误', () => {
  it('HTTP 500 时显示服务器错误 toast', async () => {
    server.use(
      mswHttp.get('http://localhost/api/crash', () =>
        // No `message` field → handleHttpError falls back to `服务器错误（500）`
        HttpResponse.json({ code: 500 }, { status: 500 }),
      ),
    );
    await expect(http.get('/crash')).rejects.toBeDefined();
    expect(mockAddToast).toHaveBeenCalledWith('error', expect.any(String));
  });

  it('HTTP 401 时跳转 /login', async () => {
    server.use(
      mswHttp.get('http://localhost/api/me', () =>
        HttpResponse.json({ message: 'Unauthorized' }, { status: 401 }),
      ),
      mswHttp.post('http://localhost/api/v1/auth/admin/clear-cookie', () =>
        HttpResponse.json({ code: 10000, message: 'ok', data: { ok: true } }),
      ),
    );
    await expect(http.get('/me')).rejects.toBeDefined();
    expect(window.location.href).toBe('/login');
  });

  it('HTTP 401 且存在 refresh_token 时自动刷新并重试原请求', async () => {
    localStorage.setItem('auth_token', 'expired-token');
    localStorage.setItem('refresh_token', 'refresh-token-1');

    let profileCallCount = 0;
    server.use(
      mswHttp.get('http://localhost/api/me', () => {
        profileCallCount += 1;
        if (profileCallCount === 1) {
          return HttpResponse.json(
            { message: 'Unauthorized' },
            { status: 401 },
          );
        }
        return HttpResponse.json({
          code: 10000,
          message: 'ok',
          data: { id: 1, name: 'admin' },
        });
      }),
      mswHttp.post('http://localhost/api/v1/auth/admin/refresh', () =>
        HttpResponse.json({
          code: 10000,
          message: 'ok',
          data: {
            tokens: {
              accessToken: 'new-access-token',
              refreshToken: 'new-refresh-token',
            },
          },
        }),
      ),
      mswHttp.post('http://localhost/api/v1/auth/admin/set-cookie', () =>
        HttpResponse.json({ code: 10000, message: 'ok', data: { ok: true } }),
      ),
    );

    const data = await http.get<{ id: number; name: string }>('/me');
    expect(data).toEqual({ id: 1, name: 'admin' });
    expect(localStorage.getItem('auth_token')).toBe('new-access-token');
    expect(localStorage.getItem('refresh_token')).toBe('new-refresh-token');
    expect(window.location.href).toBe('http://localhost/');
  });

  it('并发 401 且 refresh 失败时只触发一次 refresh 和一次跳转提示', async () => {
    localStorage.setItem('auth_token', 'expired-token');
    localStorage.setItem('refresh_token', 'refresh-token-1');

    let refreshCount = 0;
    server.use(
      mswHttp.get('http://localhost/api/protected-a', () =>
        HttpResponse.json({ message: 'Unauthorized' }, { status: 401 }),
      ),
      mswHttp.get('http://localhost/api/protected-b', () =>
        HttpResponse.json({ message: 'Unauthorized' }, { status: 401 }),
      ),
      mswHttp.post('http://localhost/api/v1/auth/admin/refresh', () => {
        refreshCount += 1;
        return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }),
      mswHttp.post('http://localhost/api/v1/auth/admin/clear-cookie', () =>
        HttpResponse.json({ code: 10000, message: 'ok', data: { ok: true } }),
      ),
    );

    await Promise.allSettled([
      http.get('/protected-a'),
      http.get('/protected-b'),
    ]);

    expect(refreshCount).toBe(1);
    expect(mockAddToast).toHaveBeenCalledWith(
      'error',
      'Unauthorized, please log in again',
    );
    expect(window.location.href).toBe('/login');
  });

  it('网络断开时显示网络错误 toast', async () => {
    server.use(
      mswHttp.get('http://localhost/api/offline', () => HttpResponse.error()),
    );
    await expect(http.get('/offline')).rejects.toBeDefined();
    expect(mockAddToast).toHaveBeenCalledWith('error', expect.any(String));
  });
});

// ═══════════════════════════════════════════════════════════════
// token 注入
// ═══════════════════════════════════════════════════════════════
describe('http client — token 注入', () => {
  it('有 token 时请求头带 Authorization', async () => {
    localStorage.setItem('auth_token', 'my-jwt');
    let capturedAuth = '';
    server.use(
      mswHttp.get('http://localhost/api/profile', ({ request }) => {
        capturedAuth = request.headers.get('Authorization') ?? '';
        return HttpResponse.json({
          code: 10000,
          data: { id: 1 },
          message: 'ok',
        });
      }),
    );
    await http.get('/profile');
    expect(capturedAuth).toBe('Bearer my-jwt');
  });

  it('无 token 时请求头无 Authorization', async () => {
    localStorage.removeItem('auth_token');
    let capturedAuth: string | null = 'present';
    server.use(
      mswHttp.get('http://localhost/api/open', ({ request }) => {
        capturedAuth = request.headers.get('Authorization');
        return HttpResponse.json({ code: 10000, data: 'ok', message: 'ok' });
      }),
    );
    await http.get('/open');
    expect(capturedAuth).toBeNull();
  });
});
