import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  makeUseRequest,
  PageHeaderMock,
  repoUiMock,
} from '../mocks/view-helpers';

const mockUseRequest = vi.hoisted(() => vi.fn());
const mockCanManageFlows = vi.hoisted(() => vi.fn(() => true));
const mockSwitchFlow = vi.hoisted(() => vi.fn());
const mockRollbackFlow = vi.hoisted(() => vi.fn());

vi.mock('ahooks', () => ({
  useRequest: (...args: unknown[]) => mockUseRequest(...args),
}));

vi.mock('@/api', () => ({
  aiOpsApi: {
    getFlowDefinitions: vi.fn(),
    getFlowBindings: vi.fn(),
    getFlowAudit: vi.fn(),
    switchFlow: (...args: unknown[]) => mockSwitchFlow(...args),
    rollbackFlow: (...args: unknown[]) => mockRollbackFlow(...args),
  },
}));

vi.mock('@/lib/ai-ops-permissions', () => ({
  useAiOpsRole: () => 'ADMIN',
  canManageFlows: () => mockCanManageFlows(),
}));

vi.mock('@/components/scaffold/PageHeader', () => ({
  PageHeader: PageHeaderMock,
}));

vi.mock('@repo/ui', () => repoUiMock);

import AiFlowsPage from '@/app/(dashboard)/ai-ops/flows/page';

const definitions = [
  {
    id: 'def-deposit-1',
    flowType: 'DEPOSIT',
    version: 1,
    definitionHash: 'hash-deposit-1-secret',
    status: 'ACTIVE',
    createdBy: 'system',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'def-deposit-2',
    flowType: 'DEPOSIT',
    version: 2,
    definitionHash: 'hash-deposit-2-secret',
    status: 'DRAFT',
    createdBy: 'admin-1',
    createdAt: '2026-01-02T00:00:00.000Z',
  },
];

const bindings = [
  {
    id: 'bind-1',
    conversationId: 'conv-1',
    flowType: 'DEPOSIT',
    definitionVersionId: 'def-deposit-1',
    definitionHash: 'hash-deposit-1-secret',
    status: 'ACTIVE',
    flowStep: 'IDLE',
    threadId: 'thread-1',
    checkpointId: null,
    updatedAt: '2026-01-03T00:00:00.000Z',
    definition: {
      version: 1,
      status: 'ACTIVE',
      definitionHash: 'hash-deposit-1-secret',
    },
  },
];

const audits = [
  {
    id: 'audit-1',
    conversationId: 'conv-1',
    flowType: 'DEPOSIT',
    action: 'SWITCH',
    actorId: 'admin-1',
    reason: '修复取款确认话术',
    fromVersionId: 'def-deposit-1',
    toVersionId: 'def-deposit-2',
    threadId: 'thread-1',
    checkpointId: null,
    createdAt: '2026-01-03T00:00:00.000Z',
  },
];

let requestCallIndex = 0;
let requestResponses: unknown[] = [];

/**
 * Pages re-run useRequest on every render, so return responses by call order
 * (definitions, bindings, audit) instead of queuing one-shot values.
 */
function requestsWith(
  definitionsResponse: unknown,
  bindingsResponse: unknown,
  auditResponse: unknown,
  contextResponse: unknown = makeUseRequest(null),
) {
  requestResponses = [
    definitionsResponse,
    bindingsResponse,
    auditResponse,
    contextResponse,
  ];
  requestCallIndex = 0;
  mockUseRequest.mockImplementation(() => {
    const response = requestResponses[requestCallIndex % 4];
    requestCallIndex += 1;
    return response;
  });
}

function requests(
  audit: ReturnType<typeof makeUseRequest> = makeUseRequest(audits),
) {
  requestsWith(
    makeUseRequest(definitions),
    makeUseRequest(bindings),
    audit,
  );
}

describe('AiFlowsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanManageFlows.mockReturnValue(true);
    mockSwitchFlow.mockResolvedValue({ ok: true });
    mockRollbackFlow.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows operator labels, current binding, and never renders raw hashes', () => {
    requests();
    const { container } = render(<AiFlowsPage />);

    expect(screen.getByTestId('page-header').textContent).toContain('流程版本');
    expect(
      screen.getByRole('button', { name: '切换流程版本' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /换回旧版本/ }),
    ).toBeTruthy();

    // 原始状态值保留在 title，正文显示中文标签。
    expect(screen.getAllByTitle('ACTIVE').length).toBeGreaterThan(0);
    expect(screen.getAllByText('生效中').length).toBeGreaterThan(0);
    expect(screen.getByTitle('DRAFT')).toBeTruthy();
    expect(screen.getByText('草稿')).toBeTruthy();

    // 当前绑定：流程类型 + 当前版本。
    expect(screen.getAllByText('充值 (DEPOSIT)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('v1').length).toBeGreaterThan(0);

    // 审计里按版本号解析 from/to，并保留原始 id 在 title。
    expect(screen.getAllByText('v2').length).toBeGreaterThan(0);
    expect(screen.getByTitle('def-deposit-1')).toBeTruthy();
    expect(screen.getByTitle('def-deposit-2')).toBeTruthy();
    expect(screen.getByText('修复取款确认话术')).toBeTruthy();
    expect(screen.getByText('切换版本')).toBeTruthy();

    expect(container.textContent).not.toContain('hash-deposit-1-secret');
    expect(container.textContent).not.toContain('hash-deposit-2-secret');
  });

  it('hides switch actions for read-only roles', () => {
    mockCanManageFlows.mockReturnValue(false);
    requests();
    render(<AiFlowsPage />);

    expect(
      screen.queryByRole('button', { name: '切换流程版本' }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: /换回旧版本/ })).toBeNull();
    expect(screen.getByText(/只读，无切换权限/)).toBeTruthy();
  });

  it('translates a rejection code and shows it inline', async () => {
    requests();
    mockSwitchFlow.mockResolvedValue({
      ok: false,
      reason: 'flow_in_progress',
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<AiFlowsPage />);
    fireEvent.change(screen.getByPlaceholderText('conversationId'), {
      target: { value: 'conv-1' },
    });
    fireEvent.change(
      screen.getByPlaceholderText('例如：修复取款流程确认话术'),
      { target: { value: '修复取款确认话术' } },
    );
    fireEvent.click(screen.getByRole('button', { name: /v1/ }));
    fireEvent.click(screen.getByRole('button', { name: '切换流程版本' }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        '流程正在填写、确认或查询中',
      ),
    );
    expect(mockSwitchFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        toVersionId: 'def-deposit-1',
        flowType: 'DEPOSIT',
        reason: '修复取款确认话术',
      }),
    );
    expect(confirmSpy.mock.calls[0][0]).toContain('修复取款确认话术');
    expect(confirmSpy.mock.calls[0][0]).toContain('不会撤销已完成的退款');
  });

  it('prevents switching to a mismatched flowType when bindings are known', () => {
    const couponDefinition = {
      ...definitions[0],
      id: 'def-coupon-1',
      flowType: 'COUPON_CLAIM',
      version: 1,
      definitionHash: 'hash-coupon-secret',
    };
    // Use the ordered implementation so re-renders after typing still resolve.
    requestsWith(
      makeUseRequest([...definitions, couponDefinition]),
      makeUseRequest(bindings),
      makeUseRequest([]),
    );

    render(<AiFlowsPage />);
    fireEvent.change(screen.getByPlaceholderText('conversationId'), {
      target: { value: 'conv-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /领券/ }));

    expect(screen.getByText(/不能跨流程类型切换/)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: '切换流程版本' }),
    ).toHaveProperty('disabled', true);
  });

  it('distinguishes audit loading from an empty audit table', () => {
    requests(makeUseRequest([], true));
    render(<AiFlowsPage />);

    expect(screen.getByText('审计日志加载中…')).toBeTruthy();
    expect(screen.queryByText('暂无审计记录')).toBeNull();
  });

  it('shows definitions errors instead of a misleading empty state', () => {
    const errored = {
      ...makeUseRequest([]),
      error: new Error('definitions down'),
    };
    requestsWith(
      errored,
      makeUseRequest([]),
      makeUseRequest([]),
    );

    render(<AiFlowsPage />);

    expect(screen.getByText(/定义版本加载失败：definitions down/)).toBeTruthy();
    expect(screen.queryByText(/暂无定义版本/)).toBeNull();
  });
});
