'use client';

import React from 'react';
import { FieldRow } from './FieldRow';
import { ToolSelector } from './ToolSelector';
import type { FormState } from './prompt-form-utils';
import type { PromptToolOption } from '@/type/types';

export interface PromptContentTabProps {
  form: FormState;
  onChange: (patch: Partial<FormState>) => void;
  /** All available tools for the selected domain (from getTools API) */
  tools?: PromptToolOption[];
  /** Whether template fields (workflow, domainRules, examples) are readonly */
  templateLocked?: boolean;
}

/**
 * Tab 1 — Prompt Content
 *
 * Field classification after template upgrade:
 * - Editable: role, displayFormat, selectedTools (via ToolSelector)
 * - Template-readonly (lock icon): workflow, domainRules, examples
 * - Legacy fallback: availableTools (hidden when ToolSelector is active)
 */
export function PromptContentTab({
  form,
  onChange,
  tools = [],
  templateLocked = false,
}: PromptContentTabProps) {
  return (
    <div className="flex flex-col gap-4">
      {/* Role — always editable */}
      <FieldRow
        label="Role"
        value={form.role}
        onChange={(v) => onChange({ role: v })}
        rows={3}
        required
        placeholder="You are the product search and browsing assistant for JoyMini platform..."
        hint="The system role instruction that defines agent identity."
      />

      {/* Workflow — pre-filled from template but always editable */}
      <FieldRow
        label="Workflow"
        value={form.workflow}
        onChange={(v) => onChange({ workflow: v })}
        rows={5}
        required
        placeholder="Step 1: Understand what the user needs&#10;Step 2: Pick the right tool..."
        hint={
          templateLocked
            ? 'Pre-filled from template. You can still modify it.'
            : 'Step-by-step workflow instructions for the agent.'
        }
      />

      {/* Available Tools — ToolSelector when tools available, else legacy textarea */}
      {tools.length > 0 ? (
        <ToolSelector
          tools={tools}
          selected={form.selectedTools}
          onChange={(v) => onChange({ selectedTools: v })}
          hint="Select the tools this agent can use."
        />
      ) : (
        <FieldRow
          label="Available Tools"
          value={form.availableTools}
          onChange={(v) => onChange({ availableTools: v })}
          rows={3}
          placeholder="searchProducts: Search/browse products&#10;getProductDetail: View product details"
          hint="List of tools the agent can use (auto-populated from code, can be overridden)."
        />
      )}

      {/* Domain Rules — pre-filled from template but always editable */}
      <FieldRow
        label="Domain Rules"
        value={form.domainRules}
        onChange={(v) => onChange({ domainRules: v })}
        rows={6}
        placeholder="## Product Data Fields&#10;When the user says..."
        hint={
          templateLocked
            ? 'Pre-filled from template. You can still modify it.'
            : 'Domain-specific rules and data field descriptions.'
        }
      />

      {/* Examples — pre-filled from template but always editable */}
      <FieldRow
        label="Examples"
        value={form.examples}
        onChange={(v) => onChange({ examples: v })}
        rows={6}
        required
        placeholder='User: "Show me popular products"&#10;→ You call getHotProducts...'
        hint={
          templateLocked
            ? 'Pre-filled from template. You can still modify it.'
            : 'Few-shot examples showing expected agent behavior.'
        }
      />

      {/* Display Format — always editable */}
      <FieldRow
        label="Display Format"
        value={form.displayFormat}
        onChange={(v) => onChange({ displayFormat: v })}
        rows={3}
        placeholder="- For product lists: Show name, price, discount..."
        hint="Instructions on how to format output for the user."
      />
    </div>
  );
}
