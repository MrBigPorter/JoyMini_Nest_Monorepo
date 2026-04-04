import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { makeUseRequest } from '../mocks/view-helpers';

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
  luckyDrawApi: {
    listActivities: vi.fn(),
    listPrizes: vi.fn(),
    listResults: vi.fn(),
    createActivity: vi.fn(),
    updateActivity: vi.fn(),
    deleteActivity: vi.fn(),
    createPrize: vi.fn(),
    updatePrize: vi.fn(),
    deletePrize: vi.fn(),
  },
}));

import { LuckyDrawManagement } from '@/components/lucky-draw/LuckyDrawClient';

const createActivity = (id: string, title: string) => ({
  id,
  createdAt: Date.now(),
  title,
  description: null,
  treasureId: null,
  treasureName: null,
  status: 1,
  startAt: null,
  endAt: null,
  prizesCount: 0,
  ticketsCount: 0,
});

const mockLuckyDrawRequests = ({
  activities,
  results,
  total,
}: {
  activities: ReturnType<typeof createActivity>[];
  results?: unknown[];
  total?: number;
}) => {
  mockUseRequest.mockImplementation(
    (_service: unknown, options?: { ready?: boolean }) => {
      if (options && 'ready' in options) {
        return makeUseRequest({
          list: results ?? [],
          total: total ?? results?.length ?? 0,
        });
      }

      return makeUseRequest({
        list: activities,
        total: activities.length,
      });
    },
  );
};

describe('LuckyDrawManagement activity count text', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows singular count label for one activity', () => {
    mockLuckyDrawRequests({
      activities: [createActivity('a1', 'Spring Draw')],
    });

    render(<LuckyDrawManagement />);

    expect(screen.getByText('1 activity')).toBeInTheDocument();
  });

  it('shows plural count label for multiple activities', () => {
    mockLuckyDrawRequests({
      activities: [
        createActivity('a1', 'Spring Draw'),
        createActivity('a2', 'Summer Draw'),
      ],
    });

    render(<LuckyDrawManagement />);

    expect(screen.getByText('2 activities')).toBeInTheDocument();
  });

  it('renders draw results panel after switching to Results tab', () => {
    mockLuckyDrawRequests({
      activities: [createActivity('a1', 'Spring Draw')],
      results: [],
    });

    render(<LuckyDrawManagement />);

    fireEvent.click(screen.getByRole('button', { name: /results/i }));

    expect(screen.getByText('Draw Results')).toBeInTheDocument();
  });

  it('shows empty hint when no activity exists in Results tab', () => {
    mockLuckyDrawRequests({ activities: [], results: [] });

    render(<LuckyDrawManagement />);

    fireEvent.click(screen.getByRole('button', { name: /results/i }));

    expect(
      screen.getByText('Create an activity first to view results.'),
    ).toBeInTheDocument();
  });

  it('shows empty results message when selected activity has no result', () => {
    mockLuckyDrawRequests({
      activities: [createActivity('a1', 'Spring Draw')],
      results: [],
      total: 0,
    });

    render(<LuckyDrawManagement />);

    fireEvent.click(screen.getByRole('button', { name: /results/i }));

    expect(screen.getByText('No draw results yet.')).toBeInTheDocument();
  });
});
