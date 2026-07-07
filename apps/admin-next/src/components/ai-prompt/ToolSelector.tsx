'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { Search, CheckSquare, Square, Layers } from 'lucide-react';
import { cn } from '@repo/ui';
import type { PromptToolOption } from '@/type/types';

export interface ToolSelectorProps {
  /** All available tools from the API */
  tools: PromptToolOption[];
  /** Currently selected tool names */
  selected: string[];
  /** Selection change handler */
  onChange: (tools: string[]) => void;
  /** Disable interaction */
  disabled?: boolean;
  /** Field label */
  label?: string;
  /** Hint text below the field */
  hint?: string;
}

/**
 * Multi-select checkbox component for choosing agent tools.
 *
 * Features:
 * - Search/filter by tool name or description
 * - Select All / Deselect All quick actions
 * - Count badge: "3/8 tools selected"
 * - Matches existing form field styling (TagInput patterns)
 */
export function ToolSelector({
  tools,
  selected,
  onChange,
  disabled = false,
  label = 'Available Tools',
  hint,
}: ToolSelectorProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return tools;
    const q = search.toLowerCase();
    return tools.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q),
    );
  }, [tools, search]);

  const isAllSelected = useMemo(
    () => filtered.length > 0 && filtered.every((t) => selected.includes(t.name)),
    [filtered, selected],
  );

  const isNoneSelected = useMemo(
    () => filtered.every((t) => !selected.includes(t.name)),
    [filtered, selected],
  );

  const toggle = useCallback(
    (name: string) => {
      if (disabled) return;
      onChange(
        selected.includes(name)
          ? selected.filter((s) => s !== name)
          : [...selected, name],
      );
    },
    [selected, onChange, disabled],
  );

  const selectAll = useCallback(() => {
    if (disabled) return;
    const currentSet = new Set(selected);
    filtered.forEach((t) => currentSet.add(t.name));
    onChange(Array.from(currentSet));
  }, [filtered, selected, onChange, disabled]);

  const deselectAll = useCallback(() => {
    if (disabled) return;
    const filteredSet = new Set(filtered.map((t) => t.name));
    onChange(selected.filter((s) => !filteredSet.has(s)));
  }, [filtered, selected, onChange, disabled]);

  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
      </label>

      {/* Search + Action bar */}
      <div className="flex items-center gap-2 mb-1">
        {/* Search input */}
        <div
          className={cn(
            'flex items-center gap-1.5 flex-1 px-2.5 py-1.5',
            'border border-gray-200 dark:border-gray-700 rounded-lg',
            'focus-within:ring-2 focus-within:ring-blue-500/30 focus-within:border-blue-500',
            'transition-colors',
          )}
        >
          <Search size={14} className="text-gray-400 shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tools..."
            disabled={disabled}
            className="flex-1 bg-transparent text-sm outline-none border-none
                       placeholder:text-gray-400 dark:placeholder:text-gray-500"
          />
        </div>

        {/* Count badge */}
        <span
          className={cn(
            'inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md shrink-0',
            selected.length > 0
              ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
              : 'bg-gray-50 dark:bg-gray-800 text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-gray-700',
          )}
        >
          <Layers size={12} />
          {selected.length}/{tools.length}
        </span>
      </div>

      {/* Select All / Deselect All */}
      <div className="flex items-center gap-2 mb-1">
        <button
          type="button"
          onClick={selectAll}
          disabled={disabled || isAllSelected}
          className={cn(
            'inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md transition-colors',
            disabled || isAllSelected
              ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
              : 'text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20',
          )}
        >
          <CheckSquare size={12} />
          Select All
        </button>
        <button
          type="button"
          onClick={deselectAll}
          disabled={disabled || isNoneSelected}
          className={cn(
            'inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md transition-colors',
            disabled || isNoneSelected
              ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
              : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800',
          )}
        >
          <Square size={12} />
          Deselect All
        </button>
      </div>

      {/* Tool list */}
      <div
        className={cn(
          'border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden',
          'divide-y divide-gray-100 dark:divide-gray-800',
          'max-h-64 overflow-y-auto',
        )}
      >
        {filtered.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-gray-400 dark:text-gray-500">
            {search
              ? 'No tools match your search'
              : 'No tools available'}
          </div>
        ) : (
          filtered.map((tool) => {
            const isSelected = selected.includes(tool.name);
            return (
              <label
                key={tool.name}
                className={cn(
                  'flex items-start gap-2.5 px-3 py-2 cursor-pointer transition-colors',
                  isSelected
                    ? 'bg-blue-50/50 dark:bg-blue-900/10'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800/50',
                  disabled && 'opacity-60 cursor-not-allowed',
                )}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggle(tool.name)}
                  disabled={disabled}
                  className="mt-0.5 rounded border-gray-300 dark:border-gray-600
                             text-blue-600 focus:ring-blue-500"
                />
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-mono font-medium text-gray-800 dark:text-gray-200">
                    {tool.name}
                  </span>
                  <span className="text-xs text-gray-400 dark:text-gray-500 line-clamp-2">
                    {tool.description}
                  </span>
                </div>
              </label>
            );
          })
        )}
      </div>

      {hint && (
        <p className="text-xs text-gray-400 dark:text-gray-500">{hint}</p>
      )}
    </div>
  );
}
