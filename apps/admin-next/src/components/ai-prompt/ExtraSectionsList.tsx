'use client';

import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, cn } from '@repo/ui';
import type { ExtraSection } from './prompt-form-utils';

export interface ExtraSectionsListProps {
  sections: ExtraSection[];
  onChange: (sections: ExtraSection[]) => void;
}

/**
 * Dynamic list of extra key-value sections.
 * Each item has a Name (section title) and Content (section body).
 * Operators can add/remove sections as needed for future extensions.
 */

export function ExtraSectionsList({
  sections,
  onChange,
}: ExtraSectionsListProps) {
  const update = (i: number, field: keyof ExtraSection, value: string) => {
    const next = sections.map((s, idx) =>
      idx === i ? { ...s, [field]: value } : s,
    );
    onChange(next);
  };

  const remove = (i: number) => {
    onChange(sections.filter((_, idx) => idx !== i));
  };

  const add = () => {
    onChange([...sections, { name: '', content: '' }]);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Extra Sections
        </label>
        <Button
          variant="outline"
          size="sm"
          onClick={add}
          className="gap-1 text-xs"
        >
          <Plus size={14} />
          Add Section
        </Button>
      </div>

      {sections.length === 0 && (
        <p className="text-xs text-gray-400 dark:text-gray-500 italic">
          No extra sections configured. Click "Add Section" to extend the
          prompt.
        </p>
      )}

      {sections.map((section, i) => (
        <div
          key={i}
          className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-2"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
              Section #{i + 1}
            </span>
            <button
              type="button"
              onClick={() => remove(i)}
              className="p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
              title="Remove section"
            >
              <Trash2 size={14} className="text-red-400 hover:text-red-600" />
            </button>
          </div>

          <input
            value={section.name}
            onChange={(e) => update(i, 'name', e.target.value)}
            placeholder="Section title (e.g. Tone Guidelines)"
            className={cn(
              'w-full px-3 py-2 border rounded-lg bg-transparent text-sm',
              'border-gray-200 dark:border-gray-700',
            )}
          />

          <textarea
            value={section.content}
            onChange={(e) => update(i, 'content', e.target.value)}
            rows={3}
            placeholder="Section content..."
            className={cn(
              'w-full px-3 py-2 border rounded-lg bg-transparent text-sm font-mono resize-none',
              'border-gray-200 dark:border-gray-700',
            )}
          />
        </div>
      ))}
    </div>
  );
}
