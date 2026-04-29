'use client';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'secondary' | 'outline' | 'destructive';
  className?: string;
  [key: string]: any;
}

/**
 * Minimal Badge component.
 * Matches the variants used in page.client.tsx (secondary, outline).
 */
function Badge({
  children,
  variant = 'default',
  className = '',
  ...props
}: BadgeProps) {
  const variantClasses: Record<string, string> = {
    default: 'bg-primary/10 text-primary border-transparent',
    secondary:
      'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-transparent',
    outline:
      'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400',
    destructive:
      'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-transparent',
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${variantClasses[variant] || variantClasses.default} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}

export { Badge };
