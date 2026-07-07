// ──────────────────────────────────────────────────
// Prompt Form Utils
// Converts between structured FormState ↔ AgentPromptConfig JSON
// for the prompt admin management UI.
// ──────────────────────────────────────────────────

export interface ExtraSection {
  name: string;
  content: string;
}

export interface FormState {
  // Operator-editable text fields
  role: string;
  displayFormat: string;
  hardRules: string;
  extraSections: ExtraSection[];

  // Operator-adjustable scope fields
  scopeDomain: string;
  handles: string[];
  outside: string[];

  // Technical template fields (readonly, from template)
  workflow: string;
  domainRules: string;
  examples: string;

  // Tool selector (replaces manual text input)
  selectedTools: string[];       // tool names selected via checkbox
  availableTools: string;        // legacy field — kept for backward compat

  // Technical fixed fields (hidden)
  flowContext: boolean;
  flowType: string;
  flowStatus: string;

  // Template metadata
  templateDomain: string;        // which domain template is loaded
  isTemplateLoaded: boolean;     // whether template was loaded
}

/**
 * Parse extraSections string[] from AgentPromptConfig back into
 * structured ExtraSection[] for the form.
 */
export function parseExtraSections(sections?: string[]): ExtraSection[] {
  if (!sections || sections.length === 0) return [];
  return sections.map((section) => {
    const match = section.match(/^##\s+(.+)\n\n([\s\S]*)$/);
    if (match) {
      return { name: match[1].trim(), content: match[2].trim() };
    }
    // Fallback: treat the whole string as content with auto-generated name
    return {
      name: `Section ${sections.indexOf(section) + 1}`,
      content: section,
    };
  });
}

/**
 * Parse a JSON config string (from DB or TS defaults) into a FormState
 * that the structured form can render.
 */
export function configToForm(config: Record<string, unknown>): FormState {
  const scope = config.scopeRestriction as
    | { domain?: string; handles?: string[]; outside?: string[] }
    | undefined;

  // Detect if config has selectedTools (new format) or needs to be derived from availableTools (legacy)
  const hasSelectedTools = Array.isArray(config.selectedTools);
  const selectedTools = hasSelectedTools
    ? (config.selectedTools as string[])
    : [];

  return {
    role: (config.role as string) ?? '',
    workflow: (config.workflow as string) ?? '',
    domainRules: (config.domainRules as string) ?? '',
    examples: (config.examples as string) ?? '',
    displayFormat: (config.displayFormat as string) ?? '',
    scopeDomain: scope?.domain ?? '',
    handles: scope?.handles ?? [],
    outside: scope?.outside ?? [],
    hardRules: Array.isArray(config.hardRules)
      ? (config.hardRules as string[]).join('\n')
      : '',
    selectedTools,
    availableTools: (config.availableTools as string) ?? '',
    flowContext: !!config.flowContext,
    flowType: (config.flowType as string) ?? '',
    flowStatus: (config.flowStatus as string) ?? '',
    extraSections: parseExtraSections(config.extraSections as string[] | undefined),
    templateDomain: (config.templateDomain as string) ?? (scope?.domain ?? ''),
    isTemplateLoaded: false,
  };
}

/**
 * Convert FormState back into a plain JSON object that matches
 * the AgentPromptConfig shape (minus userId which is added at runtime).
 */
/**
 * Format selected tool names into the availableTools text block.
 * Each tool is formatted as: "1. **toolName** - description"
 */
export function formatToolList(
  tools: { name: string; description: string }[],
  selected: string[],
): string {
  return tools
    .filter((t) => selected.includes(t.name))
    .map((t, i) => `${i + 1}. **${t.name}** - ${t.description}`)
    .join('\n');
}

/**
 * Convert FormState back into a plain JSON object that matches
 * the AgentPromptConfig shape (minus userId which is added at runtime).
 */
export function formToConfig(
  form: FormState,
  domainName: string,
  allTools?: { name: string; description: string }[],
): Record<string, unknown> {
  const config: Record<string, unknown> = {
    role: form.role,
    domainName,
    workflow: form.workflow,
    examples: form.examples,
    scopeRestriction: {
      domain: form.scopeDomain,
      handles: form.handles,
      outside: form.outside,
    },
  };

  // Optional string fields — omit if empty
  if (form.domainRules) config.domainRules = form.domainRules;
  if (form.displayFormat) config.displayFormat = form.displayFormat;

  // availableTools: prefer selectedTools (checkbox mode), fallback to manual text
  if (form.selectedTools.length > 0 && allTools) {
    config.availableTools = formatToolList(allTools, form.selectedTools);
  } else if (form.availableTools) {
    config.availableTools = form.availableTools;
  }

  // Store selectedTools for round-trip fidelity
  if (form.selectedTools.length > 0) {
    config.selectedTools = form.selectedTools;
  }

  // hardRules: split by newlines into string[]
  if (form.hardRules.trim()) {
    config.hardRules = form.hardRules
      .split('\n')
      .map((r) => r.trim())
      .filter(Boolean);
  }

  // Flow fields — only include if explicitly set (hidden in UI)
  if (form.flowContext) config.flowContext = true;
  if (form.flowType) config.flowType = form.flowType;
  if (form.flowStatus) config.flowStatus = form.flowStatus;

  // Template metadata (for round-trip)
  if (form.templateDomain) config.templateDomain = form.templateDomain;

  // Extra sections: reassemble into ## Name \n\n Content format
  if (form.extraSections.length > 0) {
    config.extraSections = form.extraSections
      .filter((s) => s.name.trim() || s.content.trim())
      .map((s) => `## ${s.name}\n\n${s.content}`);
  }

  return config;
}

/**
 * Render a preview of the assembled prompt from config fields.
 * This mirrors buildAgentPrompt() assembly order:
 * role → workflow → availableTools → domainRules → examples →
 * displayFormat → hardRules → extraSections
 */
export function renderPrompt(config: Record<string, unknown>): string {
  const parts: string[] = [];

  const role = config.role as string;
  if (role) parts.push(role);

  const workflow = config.workflow as string;
  if (workflow) parts.push(`## Workflow\n\n${workflow}`);

  const availableTools = config.availableTools as string | undefined;
  if (availableTools) parts.push(`## Available Tools\n\n${availableTools}`);

  const domainRules = config.domainRules as string | undefined;
  if (domainRules) parts.push(domainRules);

  const examples = config.examples as string;
  if (examples) parts.push(`## Examples\n\n${examples}`);

  const displayFormat = config.displayFormat as string | undefined;
  if (displayFormat) parts.push(`## Display Format\n\n${displayFormat}`);

  const hardRules = config.hardRules as string[] | undefined;
  if (hardRules && hardRules.length > 0) {
    parts.push(`## Hard Rules\n\n${hardRules.map((r) => `- ${r}`).join('\n')}`);
  }

  const extraSections = config.extraSections as string[] | undefined;
  if (extraSections && extraSections.length > 0) {
    parts.push(...extraSections);
  }

  return parts.join('\n\n');
}
