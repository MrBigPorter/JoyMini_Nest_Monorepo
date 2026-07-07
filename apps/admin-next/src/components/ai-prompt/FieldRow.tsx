'use client';

import React from 'react';
import { cn } from '@repo/ui';

export interface FieldRowProps {
  /** Field label */
  label: string;
  /** Current value */
  value: string;
  /** Change handler */
  onChange: (value: string) => void;
  /** Textarea rows (default 3) */
  rows?: number;
  /** Whether this field is required */
  required?: boolean;
  /** Error message */
  error?: string | null;
  /** Placeholder text */
  placeholder?: string;
  /** Optional hint text below the field */
  hint?: string;
  /** Use input instead of textarea */
  input?: boolean;
}

/**
 * Reusable label + textarea/input field wrapper.
 * Matches the existing styling patterns in AiPromptDetailClient.tsx.
 */
export function FieldRow({
  label,
  value,
  onChange,
  rows = 3,
  required = false,
  error,
  placeholder,
  hint,
  input: isInput = false,
}: FieldRowProps) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>

      {isInput ? (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={cn(
            'px-3 py-2 border rounded-lg bg-transparent text-sm',
            error
              ? 'border-red-500'
              : 'border-gray-200 dark:border-gray-700',
          )}
        />
      ) : (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          placeholder={placeholder}
          className={cn(
            'px-3 py-2 border rounded-lg bg-transparent text-sm font-mono resize-none',
            error
              ? 'border-red-500'
              : 'border-gray-200 dark:border-gray-700',
          )}
        />
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}
      {hint && !error && (
        <p className="text-xs text-gray-400 dark:text-gray-500">{hint}</p>
      )}
    </div>
  );
}
