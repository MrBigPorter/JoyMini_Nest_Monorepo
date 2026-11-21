import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('next/image', () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img {...props} alt={props.alt ?? ''} />
  ),
}));

import { Sidebar } from '@/components/layout/Sidebar';
import { useAuthStore } from '@/store/useAuthStore';

function setRole(role: string) {
  useAuthStore.setState({
    userInfo: {
      id: 'admin-1',
      userId: 'admin-1',
      username: 'tester',
      realName: 'Tester',
      role,
    } as never,
  });
}

function renderSidebar() {
  return render(
    <Sidebar mobileOpen={false} onMobileCloseAction={() => undefined} />,
  );
}

describe('Sidebar 角色可见性', () => {
  afterEach(() => {
    cleanup();
    useAuthStore.setState({ userInfo: null });
  });

  it('VIEWER 看不到 AI Operations · 工程', () => {
    setRole('VIEWER');
    renderSidebar();

    expect(screen.queryByText('AI Operations · 工程')).toBeNull();
    expect(screen.getByText('AI Operations · 业务')).toBeInTheDocument();
    expect(screen.getByText('AI Operations · 今日')).toBeInTheDocument();
  });

  it('EDITOR 看不到 AI Operations · 工程', () => {
    setRole('EDITOR');
    renderSidebar();

    expect(screen.queryByText('AI Operations · 工程')).toBeNull();
    expect(screen.queryByText('AI Operations · 业务')).toBeNull();
    expect(screen.queryByText('AI Operations · 今日')).toBeNull();
  });

  it('ADMIN 可以看到工程组', () => {
    setRole('ADMIN');
    renderSidebar();

    expect(screen.getByText('AI Operations · 工程')).toBeInTheDocument();
  });

  it('角色未加载时不显示工程组', () => {
    useAuthStore.setState({ userInfo: null });
    renderSidebar();

    expect(screen.queryByText('AI Operations · 工程')).toBeNull();
  });
});
