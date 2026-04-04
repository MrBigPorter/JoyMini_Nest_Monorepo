import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

const mockUseRequest = vi.hoisted(() => vi.fn());

vi.mock('ahooks', () => ({
  useRequest: (...args: unknown[]) => mockUseRequest(...args),
}));

vi.mock('@/components/scaffold/PageHeader', () => ({
  PageHeader: ({ title }: { title?: React.ReactNode }) => (
    <div data-testid="page-header">{title}</div>
  ),
}));

vi.mock('@/api', () => ({
  systemConfigApi: {
    getAll: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
}));

import { systemConfigApi } from '@/api';
import { SystemConfig } from '@/components/settings/SettingsClient';

const createConfig = (key: string, value: string) => ({ key, value });

const mockSystemConfigRequest = ({
  list,
  loading = false,
}: {
  list: ReturnType<typeof createConfig>[];
  loading?: boolean;
}) => {
  const refresh = vi.fn();
  let delivered = false;

  mockUseRequest.mockImplementation(
    (
      _service: unknown,
      options?: { onSuccess?: (data: { list: typeof list }) => void },
    ) => {
      if (!delivered) {
        options?.onSuccess?.({ list });
        delivered = true;
      }

      return {
        loading,
        run: refresh,
      };
    },
  );

  return refresh;
};

describe('SystemConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty state when config list is empty', () => {
    mockSystemConfigRequest({ list: [] });

    render(<SystemConfig />);

    expect(screen.getByTestId('page-header')).toHaveTextContent(
      'System Config',
    );
    expect(screen.getByText('No config items found')).toBeInTheDocument();
    expect(screen.getByText('0 config items')).toBeInTheDocument();
  });

  it('renders config rows and count label', () => {
    mockSystemConfigRequest({
      list: [
        createConfig('exchange_rate_usd_php', '57.2'),
        createConfig('platform_name', 'Lucky Nest'),
      ],
    });

    render(<SystemConfig />);

    expect(screen.getByText('2 config items')).toBeInTheDocument();
    expect(screen.getByText('Exchange Rate (USD → PHP)')).toBeInTheDocument();
    expect(screen.getByText('Lucky Nest')).toBeInTheDocument();
  });

  it('updates config value on Enter key while editing', async () => {
    mockSystemConfigRequest({
      list: [createConfig('platform_name', 'Lucky Nest')],
    });

    render(<SystemConfig />);

    const row = screen
      .getByText('Platform Name')
      .closest('div[class*="justify-between"]');
    expect(row).not.toBeNull();

    const editButton = within(row as HTMLDivElement).getAllByRole('button')[0];
    fireEvent.click(editButton);

    const input = screen.getByDisplayValue('Lucky Nest');
    fireEvent.change(input, { target: { value: 'Lucky Nest Pro' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(systemConfigApi.update).toHaveBeenCalledWith(
        'platform_name',
        'Lucky Nest Pro',
      );
    });

    expect(screen.getByText('Lucky Nest Pro')).toBeInTheDocument();
  });
});
