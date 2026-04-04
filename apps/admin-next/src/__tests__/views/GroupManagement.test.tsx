import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  repoUiMock,
  PageHeaderMock,
  SmartImageMock,
} from '../mocks/view-helpers';

const smartTablePropsSpy = vi.hoisted(() => vi.fn());

// ── mocks ────────────────────────────────────────────────────────
vi.mock('@repo/ui', () => repoUiMock);
vi.mock('@/components/scaffold/SmartTable', () => ({
  SmartTable: Object.assign(
    React.forwardRef(function SmartTableMock(
      props: { headerTitle?: React.ReactNode },
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _ref: React.ForwardedRef<unknown>,
    ) {
      smartTablePropsSpy(props);
      return <div data-testid="smart-table">{props.headerTitle}</div>;
    }),
    { displayName: 'SmartTableMock' },
  ),
}));
vi.mock('@/components/scaffold/PageHeader', () => ({
  PageHeader: PageHeaderMock,
}));
vi.mock('@/components/ui/SmartImage', () => ({ SmartImage: SmartImageMock }));

const mockUseRequest = vi.fn();
vi.mock('ahooks', () => ({
  useRequest: (fn: () => unknown, opts?: unknown) => mockUseRequest(fn, opts),
}));

vi.mock('@/api', () => ({
  groupApi: {
    getList: vi.fn().mockResolvedValue({ list: [], total: 0 }),
    getDetail: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('@lucky/shared', () => ({
  GROUP_STATUS: { OPEN: 1, FULL: 2, EXPIRED: 3, CANCELLED: 4 },
}));

const mockAddToast = vi.fn();
vi.mock('@/store/useToastStore', () => ({
  useToastStore: (sel: (s: { addToast: typeof mockAddToast }) => unknown) =>
    sel({ addToast: mockAddToast }),
}));

// ── subject ──────────────────────────────────────────────────────
import { GroupManagement } from '@/components/groups/GroupManagementClient';

describe('GroupManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRequest.mockReturnValue({
      data: undefined,
      loading: false,
      run: vi.fn(),
      refresh: vi.fn(),
    });
  });

  it('renders without crashing', () => {
    const { container } = render(<GroupManagement />);
    expect(container.firstChild).not.toBeNull();
  });

  it('renders SmartTable', () => {
    render(<GroupManagement />);
    expect(screen.getByTestId('smart-table')).toBeInTheDocument();
  });

  it('accepts initialFormParams and onParamsChange with hydration enabled', () => {
    const onParamsChange = vi.fn();

    render(
      <GroupManagement
        initialFormParams={{ treasureId: 't-1', status: '1' }}
        onParamsChange={onParamsChange}
      />,
    );

    expect(smartTablePropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        initialFormParams: { treasureId: 't-1', status: '1' },
        onParamsChange,
        enableHydration: true,
        hydrationQueryKey: ['groups', 1, 20, 't-1', 1, '0'],
      }),
    );
  });
});
