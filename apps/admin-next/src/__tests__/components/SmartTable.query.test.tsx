import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@repo/ui', () => ({
  Button: ({ children }: React.PropsWithChildren) => (
    <button>{children}</button>
  ),
}));
vi.mock('@/components/scaffold/BaseTable', () => ({
  BaseTable: ({
    data,
    pagination,
  }: {
    data: Array<{ id: string }>;
    pagination?: { onChange?: (page: number, pageSize: number) => void };
  }) => (
    <div>
      <div data-testid="rows">{data.map((row) => row.id).join(',')}</div>
      <button
        data-testid="goto-page-3"
        onClick={() => pagination?.onChange?.(3, 10)}
      />
    </div>
  ),
}));
vi.mock('@/components/scaffold/SchemaSearchForm', () => ({
  SchemaSearchForm: () => null,
}));
vi.mock('@/components/UIComponents', () => ({
  Badge: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
}));
vi.mock('@/lib/shared-wrapper', () => ({
  NumHelper: { formatMoney: (v: unknown) => String(v) },
  TimeHelper: {
    formatDate: (v: unknown) => String(v),
    formatDateTime: (v: unknown) => String(v),
  },
}));

import { SmartTable } from '@/components/scaffold/SmartTable/SmartTable';

const columns = [{ title: 'ID', dataIndex: 'id' }] as never;

function renderWithClient(ui: React.ReactElement, client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

describe('SmartTable query 模式（5.1 / 5.3）', () => {
  it('有 query 时不再调用 request，首屏与翻页共用 queryFn', async () => {
    const client = makeClient();
    const request = vi.fn();
    const queryFn = vi.fn().mockResolvedValue({
      data: [{ id: 'row-1' }],
      total: 1,
    });

    renderWithClient(
      <SmartTable
        rowKey="id"
        columns={columns}
        request={request}
        query={{ queryKey: () => ['smart-query'], queryFn }}
      />,
      client,
    );

    await waitFor(() =>
      expect(screen.getByTestId('rows')).toHaveTextContent('row-1'),
    );
    expect(queryFn).toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('服务端预取失败（缓存为空）时仍能客户端加载（5.3）', async () => {
    const client = makeClient();
    await client.prefetchQuery({
      queryKey: ['smart-query-fallback'],
      queryFn: async () => {
        throw new Error('server prefetch failed');
      },
    });

    // 预取失败不写入缓存，页面渲染后 useQuery 会重新取数
    expect(client.getQueryData(['smart-query-fallback'])).toBeUndefined();

    const queryFn = vi.fn().mockResolvedValue({
      data: [{ id: 'client-loaded' }],
      total: 1,
    });

    renderWithClient(
      <SmartTable
        rowKey="id"
        columns={columns}
        query={{
          queryKey: () => ['smart-query-fallback'],
          queryFn,
        }}
      />,
      client,
    );

    await waitFor(() =>
      expect(screen.getByTestId('rows')).toHaveTextContent('client-loaded'),
    );
    expect(queryFn).toHaveBeenCalled();
  });

  it('翻页把页码写回 URL 参数（5.2）', async () => {
    const client = makeClient();
    const onParamsChange = vi.fn();

    renderWithClient(
      <SmartTable
        rowKey="id"
        columns={columns}
        onParamsChange={onParamsChange}
        query={{
          queryKey: () => ['smart-query-page'],
          queryFn: async () => ({ data: [{ id: 'row-1' }], total: 30 }),
        }}
      />,
      client,
    );

    await waitFor(() =>
      expect(screen.getByTestId('goto-page-3')).toBeInTheDocument(),
    );
    screen.getByTestId('goto-page-3').click();

    expect(onParamsChange).toHaveBeenCalledWith(
      expect.objectContaining({ page: 3, pageSize: 10 }),
    );
  });
});
