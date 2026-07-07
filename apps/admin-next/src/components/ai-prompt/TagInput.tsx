'use client';

import React, { useState, useCallback } from 'react';
import { X } from 'lucide-react';
import { cn } from '@repo/ui';

export interface TagInputProps {
  /** Current tags */
  tags: string[];
  /** Change handler */
  onChange: (tags: string[]) => void;
  /** Field label */
  label: string;
  /** Placeholder text */
  placeholder?: string;
  /** Hint text below the field */
  hint?: string;
}

/**
 * Tag chip input for entering lists of items (handles, outside scopes).
 * Press Enter or comma to add a tag, click X to remove.
 */
export function TagInput({
  tags,
  onChange,
  label,
  placeholder = 'Type and press Enter to add',
  hint,
}: TagInputProps) {
  const [inputValue, setInputValue] = useState('');

  const addTag = useCallback(
    (raw: string) => {
      const val = raw.trim();
      if (val && !tags.includes(val)) {
        onChange([...tags, val]);
      }
      setInputValue('');
    },
    [tags, onChange],
  );

  const removeTag = useCallback(
    (index: number) => {
      onChange(tags.filter((_, i) => i !== index));
    },
    [tags, onChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(inputValue);
    }
    if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      removeTag(tags.length - 1);
    }
  };

  const handleBlur = () => {
    if (inputValue.trim()) {
      addTag(inputValue);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
      </label>

      <div
        className={cn(
          'flex flex-wrap items-center gap-1.5 px-3 py-2 min-h-[42px]',
          'border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent',
          'focus-within:ring-2 focus-within:ring-blue-500/30 focus-within:border-blue-500',
          'transition-colors',
        )}
      >
        {tags.map((tag, i) => (
          <span
            key={`${tag}-${i}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium
                       bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300
                       rounded-md border border-blue-200 dark:border-blue-800"
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(i)}
              className="hover:bg-blue-200 dark:hover:bg-blue-800 rounded p-0.5 transition-colors"
            >
              <X size={12} />
            </button>
          </span>
        ))}

        <input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={tags.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[80px] bg-transparent text-sm outline-none border-none
                     placeholder:text-gray-400 dark:placeholder:text-gray-500"
        />
      </div>

      {hint && (
        <p className="text-xs text-gray-400 dark:text-gray-500">{hint}</p>
      )}
    </div>
  );
}
