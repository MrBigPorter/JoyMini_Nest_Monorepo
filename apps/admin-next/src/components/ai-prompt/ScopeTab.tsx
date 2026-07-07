'use client';

import React from 'react';
import { FieldRow } from './FieldRow';
import { TagInput } from './TagInput';
import type { FormState } from './prompt-form-utils';

export interface ScopeTabProps {
  form: FormState;
  onChange: (patch: Partial<FormState>) => void;
}

/**
 * Tab 2 — Scope Restriction
 * Fields: scopeDomain, handles, outside
 */
export function ScopeTab({ form, onChange }: ScopeTabProps) {
  return (
    <div className="flex flex-col gap-4">
      <FieldRow
        label="Scope Domain"
        value={form.scopeDomain}
        onChange={(v) => onChange({ scopeDomain: v })}
        input
        required
        placeholder="product"
        hint="The domain name this agent handles (e.g. product, order, wallet)."
      />

      <TagInput
        label="Handles"
        tags={form.handles}
        onChange={(v) => onChange({ handles: v })}
        placeholder="e.g. product search, product details"
        hint="Business topics this agent CAN handle. Press Enter or comma to add."
      />

      <TagInput
        label="Outside Scope"
        tags={form.outside}
        onChange={(v) => onChange({ outside: v })}
        placeholder="e.g. wallet, orders"
        hint="Business topics this agent should NOT handle. Press Enter or comma to add."
      />
    </div>
  );
}
