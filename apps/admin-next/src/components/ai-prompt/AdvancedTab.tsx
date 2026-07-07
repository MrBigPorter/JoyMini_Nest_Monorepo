'use client';

import React from 'react';
import { FieldRow } from './FieldRow';
import { ExtraSectionsList } from './ExtraSectionsList';
import type { FormState } from './prompt-form-utils';

export interface AdvancedTabProps {
  form: FormState;
  onChange: (patch: Partial<FormState>) => void;
}

/**
 * Tab 3 — Advanced
 *
 * After template upgrade, flow context fields (flowContext, flowType, flowStatus)
 * are technical/fixed and hidden from operators. Only operator-facing fields remain:
 * - hardRules (editable)
 * - extraSections (editable)
 */
export function AdvancedTab({ form, onChange }: AdvancedTabProps) {
  return (
    <div className="flex flex-col gap-4">
      {/* Hard Rules */}
      <FieldRow
        label="Hard Rules"
        value={form.hardRules}
        onChange={(v) => onChange({ hardRules: v })}
        rows={4}
        placeholder={`- Do NOT make up product data
- Always call a tool before answering`}
        hint="One rule per line. These are appended as non-negotiable constraints."
      />

      {/* Extra Sections */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
        <ExtraSectionsList
          sections={form.extraSections}
          onChange={(v) => onChange({ extraSections: v })}
        />
      </div>
    </div>
  );
}
