'use client';

import React from 'react';
import { AlertCircle, Copy, Check } from 'lucide-react';
import { Button, cn } from '@repo/ui';
import { formToConfig, renderPrompt } from './prompt-form-utils';
import type { FormState } from './prompt-form-utils';

export interface PreviewTabProps {
  form: FormState;
  domainName: string;
}

/**
 * Tab 4 — Preview
 * Shows the assembled prompt rendered as markdown.
 * Also displays the raw JSON that will be saved.
 */
export function PreviewTab({ form, domainName }: PreviewTabProps) {
  const [jsonCopied, setJsonCopied] = React.useState(false);
  const [previewCopied, setPreviewCopied] = React.useState(false);

  // Convert form to AgentPromptConfig JSON
  const config = React.useMemo(
    () => formToConfig(form, domainName),
    [form, domainName],
  );

  const formattedJson = React.useMemo(
    () => JSON.stringify(config, null, 2),
    [config],
  );

  const renderedPreview = React.useMemo(
    () => renderPrompt(config),
    [config],
  );

  const copyToClipboard = async (
    text: string,
    setter: React.Dispatch<React.SetStateAction<boolean>>,
  ) => {
    try {
      await navigator.clipboard.writeText(text);
      setter(true);
      setTimeout(() => setter(false), 2000);
    } catch {
      // Fallback for insecure context
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setter(true);
      setTimeout(() => setter(false), 2000);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Warnings */}
      {!form.role && (
        <div className="flex items-center gap-2 p-3 text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
          <AlertCircle size={16} />
          <span>Role is required — the prompt will be incomplete.</span>
        </div>
      )}
      {!form.workflow && (
        <div className="flex items-center gap-2 p-3 text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
          <AlertCircle size={16} />
          <span>Workflow is required — the agent needs execution steps.</span>
        </div>
      )}

      {/* Rendered Preview */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Rendered Preview
          </label>
          <Button
            variant="outline"
            size="sm"
            className="gap-1 text-xs"
            onClick={() => copyToClipboard(renderedPreview, setPreviewCopied)}
          >
            {previewCopied ? <Check size={14} /> : <Copy size={14} />}
            {previewCopied ? 'Copied' : 'Copy Preview'}
          </Button>
        </div>
        <pre
          className={cn(
            'p-4 border rounded-lg bg-gray-50 dark:bg-gray-800/50 text-sm whitespace-pre-wrap font-sans',
            'border-gray-200 dark:border-gray-700',
            'max-h-[500px] overflow-y-auto',
          )}
        >
          {renderedPreview || (
            <span className="text-gray-400 italic">
              Complete the required fields to see a preview.
            </span>
          )}
        </pre>
      </div>

      {/* Raw JSON */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Raw JSON (saved to database)
          </label>
          <Button
            variant="outline"
            size="sm"
            className="gap-1 text-xs"
            onClick={() => copyToClipboard(formattedJson, setJsonCopied)}
          >
            {jsonCopied ? <Check size={14} /> : <Copy size={14} />}
            {jsonCopied ? 'Copied' : 'Copy JSON'}
          </Button>
        </div>
        <pre
          className={cn(
            'p-4 border rounded-lg bg-gray-50 dark:bg-gray-800/50 text-xs font-mono',
            'border-gray-200 dark:border-gray-700',
            'max-h-[400px] overflow-y-auto',
          )}
        >
          {formattedJson}
        </pre>
      </div>
    </div>
  );
}
