/**
 * Shared mock factories used by every view test.
 * Import these BEFORE the component under test so vi.mock hoisting works correctly.
 */
import React from 'react';
import { vi } from 'vitest';

// ─── framer-motion stub ───────────────────────────────────────────
export const framerMotionMock = {
  motion: new Proxy(
    {},
    {
      get: (_t, tag: string) => {
        const MotionTag = React.forwardRef(
          (
            {
              children,
              ...rest
            }: React.PropsWithChildren<Record<string, unknown>>,
            ref: unknown,
          ) => {
            const safe = Object.fromEntries(
              Object.entries(rest).filter(
                ([k]) =>
                  ![
                    'initial',
                    'animate',
                    'exit',
                    'variants',
                    'transition',
                    'whileHover',
                    'whileTap',
                    'layout',
                    'whileInView',
                  ].includes(k),
              ),
            );
            return React.createElement(
              tag as string,
              { ...safe, ref },
              children,
            );
          },
        );
        MotionTag.displayName = `Motion${tag}`;
        return MotionTag;
      },
    },
  ),
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
};

// ─── @repo/ui stub ───────────────────────────────────────────────
export const repoUiMock = {
  Button: ({
    children,
    onClick,
    disabled,
    className,
  }: React.PropsWithChildren<{
    onClick?: () => void;
    disabled?: boolean;
    className?: string;
  }>) => (
    <button onClick={onClick} disabled={disabled} className={className}>
      {children}
    </button>
  ),
  ModalManager: { open: vi.fn(), close: vi.fn() },
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
  Badge: ({
    children,
    className,
  }: React.PropsWithChildren<{ className?: string }>) => (
    <span className={className}>{children}</span>
  ),
  Tooltip: ({ children }: React.PropsWithChildren) => <>{children}</>,
  TooltipContent: ({ children }: React.PropsWithChildren) => (
    <div>{children}</div>
  ),
  TooltipProvider: ({ children }: React.PropsWithChildren) => <>{children}</>,
  TooltipTrigger: ({ children }: React.PropsWithChildren) => <>{children}</>,
  BaseSelect: ({ placeholder }: { placeholder?: string }) => (
    <select aria-label={placeholder}>
      <option>{placeholder}</option>
    </select>
  ),
  DropdownMenu: ({ children }: React.PropsWithChildren) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: React.PropsWithChildren) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
  }: React.PropsWithChildren<{ onClick?: () => void }>) => (
    <div role="menuitem" onClick={onClick}>
      {children}
    </div>
  ),
  DropdownMenuLabel: ({ children }: React.PropsWithChildren) => (
    <div>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: React.PropsWithChildren) => (
    <div>{children}</div>
  ),
  // ─── Form components (used by SchemaSearchForm) ───────────────
  Form: ({ children }: React.PropsWithChildren) => <>{children}</>,
  FormField: ({
    render: renderProp,
  }: {
    render: (p: { field: object }) => React.ReactNode;
  }) => <>{renderProp({ field: {} })}</>,
  FormItem: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  FormLabel: ({ children }: React.PropsWithChildren) => (
    <label>{children}</label>
  ),
  FormControl: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  FormMessage: ({ children }: React.PropsWithChildren) => (
    <span>{children}</span>
  ),
  FormTextField: ({
    name,
    label,
    placeholder,
  }: {
    name?: string;
    label?: string;
    placeholder?: string;
  }) => (
    <div>
      {label && <label htmlFor={name}>{label}</label>}
      <input id={name} name={name} placeholder={placeholder} />
    </div>
  ),
  FormSelectField: ({
    name,
    label,
    options = [],
    placeholder,
  }: {
    name?: string;
    label?: string;
    options?: { label: string; value: string }[];
    placeholder?: string;
  }) => (
    <div>
      {label && <label htmlFor={name}>{label}</label>}
      <select id={name} name={name} aria-label={placeholder}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  ),
  FormDateField: ({ name, label }: { name?: string; label?: string }) => (
    <div>
      {label && <label htmlFor={name}>{label}</label>}
      <input type="date" id={name} name={name} />
    </div>
  ),
  FormTextareaField: ({ name, label }: { name?: string; label?: string }) => (
    <div>
      {label && <label htmlFor={name}>{label}</label>}
      <textarea id={name} name={name} />
    </div>
  ),
  FormPasswordField: ({
    name,
    label,
    placeholder,
  }: {
    name?: string;
    label?: string;
    placeholder?: string;
  }) => (
    <div>
      {label && <label htmlFor={name}>{label}</label>}
      <input type="password" id={name} name={name} placeholder={placeholder} />
    </div>
  ),
  FormCheckboxField: ({ name, label }: { name?: string; label?: string }) => (
    <div>
      <input type="checkbox" id={name} name={name} />
      {label && <label htmlFor={name}>{label}</label>}
    </div>
  ),
  FormSwitchField: ({ name, label }: { name?: string; label?: string }) => (
    <div>
      <input type="checkbox" role="switch" id={name} name={name} />
      {label && <label htmlFor={name}>{label}</label>}
    </div>
  ),
};

// ─── @repo/ui/components/ui/badge stub ──────────────────────────
export const repoUiBadgeMock = {
  Badge: ({
    children,
    className,
  }: React.PropsWithChildren<{ className?: string; variant?: string }>) => (
    <span className={className}>{children}</span>
  ),
};

// ─── ahooks helpers ──────────────────────────────────────────────
export function makeUseRequest<T>(data: T, loading = false) {
  return {
    data,
    loading,
    error: undefined,
    run: vi.fn(),
    runAsync: vi.fn().mockResolvedValue(data),
    refresh: vi.fn(),
    mutate: vi.fn(),
    cancel: vi.fn(),
    params: [],
  };
}

export function makeUseAntdTable<T>(
  list: T[],
  total = list.length,
  loading = false,
) {
  return {
    tableProps: {
      dataSource: list,
      loading,
      pagination: { current: 1, pageSize: 20, total, showSizeChanger: true },
      onChange: vi.fn(),
      rowKey: 'id',
    },
    search: {
      type: 'simple',
      submit: vi.fn(),
      reset: vi.fn(),
      run: vi.fn(),
      submitValue: {},
    },
    loading,
    refresh: vi.fn(),
    run: vi.fn(),
    params: [{ current: 1, pageSize: 20 }, {}],
  };
}

// ─── Scaffold component stubs ────────────────────────────────────
export const SmartTableMock = ({
  headerTitle,
  'data-testid': testId,
}: {
  headerTitle?: React.ReactNode;
  'data-testid'?: string;
}) => <div data-testid={testId ?? 'smart-table'}>{headerTitle}</div>;

export const BaseTableMock = ({ data }: { data?: unknown[] }) => (
  <table data-testid="base-table">
    <tbody>
      {(data ?? []).map((_r, i) => (
        <tr key={i}>
          <td>row {i}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

export const SchemaSearchFormMock = ({
  onSearch,
}: {
  onSearch?: (v: unknown) => void;
}) => (
  <form
    data-testid="search-form"
    onSubmit={(e) => {
      e.preventDefault();
      onSearch?.({});
    }}
  />
);

export const PageHeaderMock = ({
  title,
  extra,
}: {
  title?: React.ReactNode;
  extra?: React.ReactNode;
}) => (
  <div data-testid="page-header">
    {title}
    {extra}
  </div>
);

export const SmartImageMock = ({
  src,
  alt,
}: {
  src?: string;
  alt?: string;
}) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img src={src ?? ''} alt={alt ?? ''} data-testid="smart-image" />
);
