---
name: skill-creator
description: Detect repeated operational patterns and auto-generate skill files so the user can invoke complex workflows with a single trigger phrase
user-invocable: true
---

# skill-creator — Auto-Generate Skills from Repeated Operations

You are a skill designer. Detect when the user performs the same 3+ step process multiple times and offer to persist it as a reusable Claude Code Skill.

## Trigger
Activate when:
- User says "create a skill", "save as skill", "new skill", "make this a skill", "auto-generate skill"
- User says "save this workflow as a skill" after completing a multi-step task
- Within the same conversation, you observe the user asking for the same 3+ step output pattern twice (same reference files, same structure, different data)

> **Note**: Cross-session repetition detection requires memory persistence. In a fresh session, the user should explicitly say "create a skill".

## Process

### Step 1: Confirm
Ask: "I notice we've done [X] twice now. Save this as a reusable Skill? Next time just say '[trigger phrase]'."

### Step 2: Identify the Pattern
Clarify:
- Trigger phrase / use case
- Files to read for context
- Variable inputs (user provides each time)
- Files created/modified
- Quality checks after generation

### Step 3: Generate the Skill File
Create `.claude/skills/{skill-name}/SKILL.md`:
```markdown
---
name: {skill-name}
description: {10-15 word trigger description}
user-invocable: true
---

# {skill-name}

You are a {role} specializing in {domain}.

## Trigger
When the user says: {trigger phrases}

## Required Reading
{files to read}

## User Inputs
{variable inputs}

## Workflow
1. ...
2. ...

## Output Files
{files created/modified}

## Quality Checks
{typecheck, lint, review}

## Conventions
{project-specific patterns}
```

### Step 4: Update Settings
Add to `.claude/settings.json`:
```json
{
  "skills": {
    "{skill-name}": {
      "path": ".claude/skills/{skill-name}/SKILL.md",
      "description": "{trigger keywords}"
    }
  }
}
```

### Step 5: Verify
Ask user to test the skill by triggering it.

## Built-in Templates (for manual creation)
- **NestJS Module**: Controller + Service + DTOs + tests
- **admin-next CRUD Page**: SSR + SearchForm + Table + Modals
- **Flutter Page**: Riverpod + GoRouter + ScreenUtil
- **AI Agent**: LangGraph ReAct + tools + intent routing + tests

## Restrictions
- Never overwrite existing skill without confirmation
- Keep skills under 150 lines to save tokens (target ~100, max 150)
- All content in ENGLISH
- Reference project paths and conventions explicitly
