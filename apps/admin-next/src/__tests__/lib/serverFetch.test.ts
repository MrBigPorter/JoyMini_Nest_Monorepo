import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SENTRY_SPAN_ATTR_KEY,
  SENTRY_SPAN_NAME,
  SENTRY_SPAN_OP,
} from '@/lib/sentry-span-constants';

const cookiesMock = vi.fn();
const startSpanMock = vi.fn();

vi.mock('next/headers', () => ({
  cookies: cookiesMock,
}));

vi.mock('@sentry/nextjs', () => ({
  startSpan: startSpanMock,
}));

describe('serverGet', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.INTERNAL_API_URL = 'http://internal-api.test/api';

    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: 'server-token' }),
    });

    startSpanMock.mockImplementation(async (_options, callback) => callback());

    global.fetch = vi.fn();
  });

  it('wraps the request in a Sentry span and forwards auth header/query params', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        code: 10000,
        data: { totalDeposit: '1000' },
      }),
    } as unknown as Response);

    const { serverGet } = await import('@/lib/serverFetch');
    const data = await serverGet<{ totalDeposit: string }>(
      '/v1/admin/finance/statistics',
      {
        page: 1,
        pageSize: 20,
      },
      { revalidate: false },
    );

    expect(data).toEqual({ totalDeposit: '1000' });
    expect(startSpanMock).toHaveBeenCalledTimes(1);
    expect(startSpanMock).toHaveBeenCalledWith(
      {
        name: SENTRY_SPAN_NAME.SERVER_FETCH_REQUEST,
        op: SENTRY_SPAN_OP.HTTP_CLIENT,
        attributes: {
          [SENTRY_SPAN_ATTR_KEY.HTTP_METHOD]: 'GET',
          [SENTRY_SPAN_ATTR_KEY.HTTP_ROUTE]: '/v1/admin/finance/statistics',
          [SENTRY_SPAN_ATTR_KEY.FETCH_REVALIDATE]: 0,
        },
      },
      expect.any(Function),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      'http://internal-api.test/api/v1/admin/finance/statistics?page=1&pageSize=20',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer server-token',
          'Content-Type': 'application/json',
        }),
        next: { revalidate: 0 },
      }),
    );
  });

  it('throws an API error when response code is not successful', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        code: 50000,
        message: 'boom',
      }),
    } as unknown as Response);

    const { serverGet } = await import('@/lib/serverFetch');

    await expect(serverGet('/v1/admin/finance/statistics')).rejects.toThrow(
      '[serverFetch] /v1/admin/finance/statistics → boom',
    );
    expect(startSpanMock).toHaveBeenCalledTimes(1);
  });
});
