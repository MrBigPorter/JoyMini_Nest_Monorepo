import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Badge,
  Card,
  Button,
  Input,
  Switch,
  Toast,
  ToastContainer,
} from '@/components/UIComponents';
import type { ToastMessage } from '@/components/UIComponents';

// ── framer-motion mock (让 motion.* 退化为普通 DOM 元素) ─────────
vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: (_target, tag: string) => {
        const MotionTag = React.forwardRef(
          (
            {
              children,
              ...rest
            }: { children?: React.ReactNode; [key: string]: unknown },
            ref: unknown,
          ) => {
            const filteredProps = Object.fromEntries(
              Object.entries(rest).filter(
                ([key]) =>
                  ![
                    'initial',
                    'animate',
                    'exit',
                    'variants',
                    'transition',
                    'whileHover',
                    'whileTap',
                    'layout',
                  ].includes(key),
              ),
            );
            return React.createElement(
              tag as string,
              { ...filteredProps, ref },
              children,
            );
          },
        );
        MotionTag.displayName = `Motion${tag}`;
        return MotionTag;
      },
    },
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}));

// ═══════════════════════════════════════════════════════════════
// Badge
// ═══════════════════════════════════════════════════════════════
describe('Badge', () => {
  it('渲染子内容', () => {
    render(<Badge>Active</Badge>);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('默认 color 为 blue', () => {
    const { container } = render(<Badge>Test</Badge>);
    expect(container.firstChild).toHaveClass('bg-blue-100');
  });

  it('color=green 时应用 green 样式', () => {
    const { container } = render(<Badge color="green">OK</Badge>);
    expect(container.firstChild).toHaveClass('bg-emerald-100');
  });

  it('color=red 时应用 red 样式', () => {
    const { container } = render(<Badge color="red">Failed</Badge>);
    expect(container.firstChild).toHaveClass('bg-red-100');
  });

  it('color=yellow 时应用 amber 样式', () => {
    const { container } = render(<Badge color="yellow">Pending</Badge>);
    expect(container.firstChild).toHaveClass('bg-amber-100');
  });
});

// ═══════════════════════════════════════════════════════════════
// Card
// ═══════════════════════════════════════════════════════════════
describe('Card', () => {
  it('渲染 children', () => {
    render(<Card>Hello Card</Card>);
    expect(screen.getByText('Hello Card')).toBeInTheDocument();
  });

  it('传入 title 时显示标题', () => {
    render(<Card title="My Title">content</Card>);
    expect(screen.getByText('My Title')).toBeInTheDocument();
  });

  it('传入 action 时渲染 action 节点', () => {
    render(<Card action={<button>Click me</button>}>body</Card>);
    expect(screen.getByText('Click me')).toBeInTheDocument();
  });

  it('支持自定义 className', () => {
    const { container } = render(<Card className="custom-class">c</Card>);
    expect(container.firstChild).toHaveClass('custom-class');
  });
});

// ═══════════════════════════════════════════════════════════════
// Button
// ═══════════════════════════════════════════════════════════════
describe('Button', () => {
  it('渲染子内容', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('点击时触发 onClick', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click</Button>);
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('isLoading=true 时按钮禁用', () => {
    render(<Button isLoading>Save</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('isLoading=true 时不触发 onClick', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button isLoading onClick={onClick}>
        Save
      </Button>,
    );
    await user.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('disabled 时不触发 onClick', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Del
      </Button>,
    );
    await user.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('variant=danger 时应用 red 样式', () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-red-500');
  });
});

// ═══════════════════════════════════════════════════════════════
// Input
// ═══════════════════════════════════════════════════════════════
describe('Input', () => {
  it('渲染 label', () => {
    render(<Input label="Email" />);
    expect(screen.getByText('Email')).toBeInTheDocument();
  });

  it('用户输入时更新 value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Input onChange={onChange} />);
    await user.type(screen.getByRole('textbox'), 'hello');
    expect(onChange).toHaveBeenCalled();
  });

  it('显示 error 提示', () => {
    render(<Input error="Required field" />);
    expect(screen.getByText('Required field')).toBeInTheDocument();
  });

  it('有 error 时 input 带 red border 样式', () => {
    render(<Input error="Oops" />);
    const input = screen.getByRole('textbox');
    // border-red-500 is applied to the wrapper div, not the <input> itself
    expect(input.parentElement).toHaveClass('border-red-500');
  });
});

// ═══════════════════════════════════════════════════════════════
// Switch
// ═══════════════════════════════════════════════════════════════
describe('Switch', () => {
  it('渲染 label', () => {
    render(<Switch label="Enable" checked={false} onChange={vi.fn()} />);
    expect(screen.getByText('Enable')).toBeInTheDocument();
  });

  it('unchecked 时 aria-checked=false', () => {
    render(<Switch checked={false} onChange={vi.fn()} />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('checked 时 aria-checked=true', () => {
    render(<Switch checked={true} onChange={vi.fn()} />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('点击时调用 onChange(!checked)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} />);
    await user.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// Toast
// ═══════════════════════════════════════════════════════════════
describe('Toast', () => {
  const makeToast = (overrides: Partial<ToastMessage> = {}): ToastMessage => ({
    id: '1',
    type: 'success',
    message: 'Saved!',
    ...overrides,
  });

  it('渲染 message', () => {
    render(<Toast toast={makeToast()} onClose={vi.fn()} />);
    expect(screen.getByText('Saved!')).toBeInTheDocument();
  });

  it('点击关闭按钮调用 onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Toast toast={makeToast({ id: 'abc' })} onClose={onClose} />);
    await user.click(screen.getByRole('button'));
    expect(onClose).toHaveBeenCalledWith('abc');
  });

  it('3 秒后自动关闭', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<Toast toast={makeToast({ id: 'timer-test' })} onClose={onClose} />);
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(onClose).toHaveBeenCalledWith('timer-test');
    vi.useRealTimers();
  });
});

// ═══════════════════════════════════════════════════════════════
// ToastContainer
// ═══════════════════════════════════════════════════════════════
describe('ToastContainer', () => {
  it('渲染所有 toast', () => {
    const toasts: ToastMessage[] = [
      { id: '1', type: 'success', message: 'Done' },
      { id: '2', type: 'error', message: 'Fail' },
    ];
    render(<ToastContainer toasts={toasts} removeToast={vi.fn()} />);
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('Fail')).toBeInTheDocument();
  });

  it('空数组时不渲染任何 toast', () => {
    const { container } = render(
      <ToastContainer toasts={[]} removeToast={vi.fn()} />,
    );
    expect(container.querySelectorAll('[class*="border-l-"]')).toHaveLength(0);
  });
});
