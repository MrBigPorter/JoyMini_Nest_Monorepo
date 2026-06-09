import { beforeEach, describe, expect, it, vi } from 'vitest';

const cookiesMock = vi.fn();

vi.mock('next/headers', () => ({
  cookies: cookiesMock,
}));

describe('serverGet', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.INTERNAL_API_URL = 'http://internal-api.test/api';

    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: 'server-token' }),
    });

    global.fetch = vi.fn();
  });

  it('forwards auth header and query params', async () => {
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
  });
});
