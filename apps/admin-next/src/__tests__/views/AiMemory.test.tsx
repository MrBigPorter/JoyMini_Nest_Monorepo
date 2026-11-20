import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  makeUseRequest,
  PageHeaderMock,
  repoUiMock,
} from '../mocks/view-helpers';
import type { AiMemoryRow, ClientUserListItem } from '@/type/types';

const mockUseRequest = vi.hoisted(() => vi.fn());
const mockGetUsers = vi.hoisted(() => vi.fn());
const mockGetUserById = vi.hoisted(() => vi.fn());
const mockGetMemoryUser = vi.hoisted(() => vi.fn());
const mockDeleteMemory = vi.hoisted(() => vi.fn());
const mockDeleteUserMemories = vi.hoisted(() => vi.fn());
const mockCanRead = vi.hoisted(() => vi.fn(() => true));
const mockCanDelete = vi.hoisted(() => vi.fn(() => true));
const mockRole = vi.hoisted(() => vi.fn(() => 'SUPER_ADMIN'));

vi.mock('ahooks', () => ({
  useRequest: (...args: unknown[]) => mockUseRequest(...args),
}));

vi.mock('@/api', () => ({
  clientUserApi: {
    getUsers: (...args: unknown[]) => mockGetUsers(...args),
    getUserById: (...args: unknown[]) => mockGetUserById(...args),
  },
  aiOpsApi: {
    getMemoryUser: (...args: unknown[]) => mockGetMemoryUser(...args),
    deleteMemory: (...args: unknown[]) => mockDeleteMemory(...args),
    deleteUserMemories: (...args: unknown[]) => mockDeleteUserMemories(...args),
  },
}));

vi.mock('@/lib/ai-ops-permissions', () => ({
  useAiOpsRole: () => mockRole(),
  canReadMemory: () => mockCanRead(),
  canDeleteMemory: () => mockCanDelete(),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/components/scaffold/PageHeader', () => ({
  PageHeader: PageHeaderMock,
}));

vi.mock('@repo/ui', () => repoUiMock);

import AiMemoryPage from '@/app/(dashboard)/ai-ops/memory/page';

const user: ClientUserListItem = {
  id: 'u1',
  nickname: '张三',
  phone: '13812341234',
  avatar: '',
  vipLevel: 0,
  kycStatus: 1,
  inviteCode: 'INV-001',
  createdAt: 0,
  lastLoginAt: 0,
  status: 1,
  wallet: { realBalance: '0', coinBalance: '0' },
};

function memory(overrides: Partial<AiMemoryRow> = {}): AiMemoryRow {
  return {
    id: 'm1',
    userId: 'u1',
    kind: 'preference',
    key: 'language',
    value: 'zh',
    confidence: 0.9,
    sourceConversationId: 'conv-1',
    sourceMessageId: null,
    version: 1,
    status: 'ACTIVE',
    expiresAt: '2027-01-01T00:00:00.000Z',
    lastUsedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function memoryPayload(
  memories: AiMemoryRow[] = [memory()],
  summaries: unknown[] = [
    {
      id: 's1',
      userId: 'u1',
      threadId: 'thread-1',
      conversationId: 'conv-1',
      summary: '用户咨询订单进度',
      coveredToSeqId: 10,
      tokenCount: 20,
      expiresAt: '2027-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
) {
  return {
    userId: 'u1',
    memories,
    summaries,
    // 搜索与记忆读取共用同一份 mock 返回值，便于测试聚焦页面行为。
    list: [user],
    total: 1,
    page: 1,
    pageSize: 10,
    totalPages: 1,
  };
}

function openByDirectUserId(id = 'u1') {
  fireEvent.change(screen.getByPlaceholderText('userId（高级）'), {
    target: { value: id },
  });
  fireEvent.click(screen.getByRole('button', { name: '查看记忆' }));
}

describe('AiMemoryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanRead.mockReturnValue(true);
    mockCanDelete.mockReturnValue(true);
    mockRole.mockReturnValue('SUPER_ADMIN');
    mockUseRequest.mockReturnValue(makeUseRequest(memoryPayload()));
    mockGetUsers.mockResolvedValue({
      list: [user],
      total: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });
    mockGetUserById.mockResolvedValue(user);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('searches users by phone and shows a masked result with an action', async () => {
    render(<AiMemoryPage />);

    fireEvent.change(screen.getByPlaceholderText('手机号'), {
      target: { value: '13812341234' },
    });
    fireEvent.click(screen.getByRole('button', { name: '搜索用户' }));

    await waitFor(() => {
      expect(mockGetUsers).toHaveBeenCalledWith({
        page: 1,
        pageSize: 10,
        phone: '13812341234',
      });
    });

    expect(await screen.findByText('张三')).toBeTruthy();
    expect(screen.getByText('138****1234')).toBeTruthy();
    expect(
      screen.getAllByRole('button', { name: '查看记忆' }).length,
    ).toBeGreaterThan(0);
  });

  it('groups memories by business category and keeps the raw key visible', () => {
    mockUseRequest.mockReturnValue(
      makeUseRequest(
        memoryPayload([
          memory({
            id: 'm1',
            kind: 'preference',
            key: 'language',
            value: 'zh',
          }),
          memory({
            id: 'm2',
            kind: 'preference',
            key: 'addressAs',
            value: '王先生',
          }),
          memory({ id: 'm3', kind: 'fact', key: 'city', value: '上海' }),
          memory({ id: 'm4', kind: 'legacy', key: 'unknown_key', value: 'x' }),
        ]),
      ),
    );

    render(<AiMemoryPage />);
    openByDirectUserId();

    expect(
      screen.getByRole('heading', { level: 3, name: /基本信息/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 3, name: /偏好/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 3, name: /业务事实/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 3, name: /其他/ }),
    ).toBeTruthy();
    expect(screen.getByTitle('称呼（addressAs）')).toBeTruthy();
    expect(screen.getByTitle('语言偏好（language）')).toBeTruthy();
    expect(screen.getByTitle('所在城市（city）')).toBeTruthy();
    expect(screen.getByTitle('unknown_key（unknown_key）')).toBeTruthy();
    expect(screen.getByText(/软删除（需后台恢复）/)).toBeTruthy();
  });

  it('shows an API error instead of an empty-state message', () => {
    mockUseRequest.mockReturnValue({
      ...makeUseRequest(null),
      error: { message: '读取记忆接口失败' },
    });

    render(<AiMemoryPage />);
    openByDirectUserId();

    expect(screen.getByText('读取记忆接口失败')).toBeTruthy();
    expect(screen.queryByText('该用户暂无长期记忆')).toBeNull();
  });

  it('shows an explicit empty state when the user has no memories', () => {
    mockUseRequest.mockReturnValue(makeUseRequest(memoryPayload([], [])));

    render(<AiMemoryPage />);
    openByDirectUserId();

    expect(screen.getByText('该用户暂无长期记忆')).toBeTruthy();
    expect(screen.getByText('暂无会话摘要')).toBeTruthy();
  });

  it('hides every delete action when the role cannot delete memories', () => {
    mockCanDelete.mockReturnValue(false);

    render(<AiMemoryPage />);
    openByDirectUserId();

    expect(screen.queryByRole('button', { name: '删除' })).toBeNull();
    expect(screen.queryByRole('button', { name: '删除全部记忆' })).toBeNull();
    expect(screen.queryByText('危险操作')).toBeNull();
  });

  it('blocks the page for roles without memory read permission', () => {
    mockCanRead.mockReturnValue(false);

    render(<AiMemoryPage />);

    expect(screen.getByText(/无权查看客户记忆/)).toBeTruthy();
    expect(screen.queryByPlaceholderText('手机号')).toBeNull();
  });
});
