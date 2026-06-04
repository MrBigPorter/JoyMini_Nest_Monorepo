# 📚 Documentation — JoyMini Nest Monorepo

> **Unified documentation system based on the Flutter doc pattern**  
> Last updated: 2026-06-04

---

## 🎯 Goals

A unified documentation system designed to:

1. **Boost AI collaboration** — Standardized format helps AI tools understand the project faster
2. **Enforce consistent conventions** — All tech stacks follow the same doc structure and standards
3. **Preserve institutional knowledge** — Clear hierarchy with cross-references
4. **Automate maintenance** — Quality checks and update workflows

---

## 📁 Directory Layout

```
docs/
├── nextjs/                    # Next.js project docs
│   ├── AI_COLLABORATION_WORKFLOW.md
│   ├── AUTH_ARCHITECTURE_ZERO_FLICKER.md
│   ├── AUTH_INTERCEPTION_ARCHITECTURE.md
│   ├── BUGFIX_auth_hydration_layout_issues.md
│   ├── BUGFIX_header_dropdown_hover_interaction.md
│   ├── BUGFIX_navigation_active_state_hydration.md
│   ├── BUGFIX_react_markdown_integration.md
│   ├── BUGFIX_tailwind_v4_migration.md
│   ├── COMMANDS_CHEATSHEET.md
│   ├── CSS_CONSTANTS_HYDRATION_SOLUTION.md
│   ├── I18N_ARCHITECTURE.md
│   ├── LANGUAGE_ZERO_FLICKER_FINAL_ARCHITECTURE.md
│   ├── NEXTJS_RENDERING_MODES_FINAL_GUIDE.md
│   ├── PAGE_TRANSITION_ANIMATION_IMPLEMENTATION.md
│   ├── PROVIDERS_GUIDE.md
│   └── ZERO_SKELETON_OPTIMIZATION_GUIDE.md
│
├── nestjs/                    # NestJS project docs
│   ├── AI_COLLABORATION_WORKFLOW.md
│   └── COMMANDS_CHEATSHEET.md
│
├── oauth/                     # OAuth / third-party login docs
│   ├── README.md
│   ├── THIRD_PARTY_LOGIN_UNIFIED_SOLUTION_V2.md
│   ├── current-implementation/
│   └── guides/
│
├── blog/                      # Blog system docs (architecture, development, security)
│   ├── README.md
│   ├── architecture/
│   ├── development/
│   ├── security/
│   ├── i18n/
│   ├── operations/
│   ├── features/
│   ├── api/
│   ├── articles/              # Published blog articles (Chinese)
│   └── plans/
│
├── read/                      # Onboarding / newcomer docs
│
├── history/                   # Past phase records
│
├── apple-oauth-setup.md
├── ai-constitution-detailed.md
├── full-deployment-guide.md
├── LANGUAGE_DETECTION_IMPROVEMENT.md
├── HYDRATION_MISMATCH_GUIDE.md
└── README.md                  # This file (navigation index)
```

---

## 🚀 Quick Start

### Newcomer — Read in Order

1. **Project overview**: [`../README.md`](../README.md) (root README)
2. **Project architecture**: [`../RUNBOOK.md`](../RUNBOOK.md)
3. **Deployment guide**: [`full-deployment-guide.md`](full-deployment-guide.md)

### AI Collaboration — Required Reading

1. **NestJS**: [`nestjs/AI_COLLABORATION_WORKFLOW.md`](nestjs/AI_COLLABORATION_WORKFLOW.md)
2. **Next.js**: [`nextjs/AI_COLLABORATION_WORKFLOW.md`](nextjs/AI_COLLABORATION_WORKFLOW.md)

### Command Cheatsheets

1. **NestJS**: [`nestjs/COMMANDS_CHEATSHEET.md`](nestjs/COMMANDS_CHEATSHEET.md)
2. **Next.js**: [`nextjs/COMMANDS_CHEATSHEET.md`](nextjs/COMMANDS_CHEATSHEET.md)

---

## 🔍 Finding Documents by Topic

| If you need…                                  | Look here                                                      |
| --------------------------------------------- | -------------------------------------------------------------- |
| Understand project architecture               | [`../RUNBOOK.md`](../RUNBOOK.md)                               |
| Deploy or troubleshoot                        | [`full-deployment-guide.md`](full-deployment-guide.md)         |
| Set up OAuth / third-party login              | [`oauth/README.md`](oauth/README.md)                           |
| Write a new technical document                | [`TECHNICAL_DOCUMENT_TEMPLATE.md`](TECHNICAL_DOCUMENT_TEMPLATE.md) |
| Read AI constitution & rules                  | [`ai-constitution-detailed.md`](ai-constitution-detailed.md)   |
| Onboard as a new developer                    | [`read/`](read/) directory                                     |
| Fix a hydration mismatch                      | [`HYDRATION_MISMATCH_GUIDE.md`](HYDRATION_MISMATCH_GUIDE.md)   |
| Improve language detection                    | [`LANGUAGE_DETECTION_IMPROVEMENT.md`](LANGUAGE_DETECTION_IMPROVEMENT.md) |
| Read published blog articles (Chinese)        | [`blog/articles/`](blog/articles/) directory                   |
| Browse blog system architecture               | [`blog/architecture/`](blog/architecture/)                     |
| Blog development guides                       | [`blog/development/`](blog/development/)                       |
| Blog security docs                            | [`blog/security/`](blog/security/)                             |
| i18n implementation                           | [`blog/i18n/`](blog/i18n/)                                     |
| Blog operations / DevOps                      | [`blog/operations/`](blog/operations/)                         |

---

## 📖 Language Policy

| Document type | Language | Audience |
|---|---|---|
| **Project documentation** (architecture, deployment, guides, templates) | **English** | International developers, AI tools |
| **Published blog articles** (`docs/blog/articles/`) | **Chinese** | Chinese tech readers |
| **Plans** (`plans/`, `docs/blog/plans/`) | **Chinese** | Internal team |

---

## 📊 Quality Assurance

### Pre-Commit Checklist

```
[x] 1. Is this a significant change requiring communication?
[x] 2. Have you stated the problem and gotten confirmation?
[x] 3. Have you designed the solution and gotten approval?
[x] 4. Have you assessed risks and gotten confirmation?
[x] 5. Do you have explicit authorization to proceed?
[x] 6. Have you reviewed all related documentation?
[x] 7. Is the environment ready for implementation?
[x] 8. Is there a detailed implementation plan?
```

### Command Execution Checklist

```
[x] 1. Have you checked the relevant command cheatsheet?
[x] 2. Are you using the project-specific command (e.g. `make`)?
[x] 3. Is the environment correct (dev/staging/production)?
[x] 4. Are required flags and arguments included?
[x] 5. Is the command's purpose documented?
[x] 6. Has the result been verified?
```

### Must-Reference Documents

1. **AI instructions**: `.github/copilot-instructions.md` (read at start of every session)
2. **Workflow**: Corresponding tech stack `AI_COLLABORATION_WORKFLOW.md`
3. **Cheatsheet**: Corresponding tech stack `COMMANDS_CHEATSHEET.md`
4. **Template**: [`TECHNICAL_DOCUMENT_TEMPLATE.md`](TECHNICAL_DOCUMENT_TEMPLATE.md)

---

## 📈 Expected Benefits

### AI Collaboration

- **50% less context-gathering time** — Unified format lets AI understand the project faster
- **80% higher command accuracy** — Standardized cheatsheets reduce mistakes
- **Smoother workflow** — Clear AI collaboration processes

### Developer Experience

- **Consistency** — All tech stacks share the same doc format
- **Knowledge transfer** — New members can ramp up across different stacks
- **Troubleshooting** — Standardized debug sections speed up resolution

---

## 🔄 Maintenance Conventions

### Adding New Documents

1. **Choose directory** by tech stack (`nestjs/`, `nextjs/`, `oauth/`, etc.)
2. **Use the template**: [`TECHNICAL_DOCUMENT_TEMPLATE.md`](TECHNICAL_DOCUMENT_TEMPLATE.md)
3. **Update this navigation** — add entry to the tables above
4. **Cross-reference** — link to related documents

### Updating Documents

1. **Version record** — add a changelog entry at the bottom
2. **Update date** — refresh the last-updated field
3. **Notify stakeholders** — if the change is significant

### Quality Checks

1. **Completeness** — ensure all required sections are present
2. **Links** — verify all cross-references work
3. **Format** — confirm the document follows the standard template
4. **Accuracy** — ensure the content is up to date

---

## 🚀 Future Plans

1. **Automated quality checks** — script to verify links, format, and completeness
2. **Auto-generated API docs** — from code comments
3. **Versioned docs** — synchronised with code releases
4. **Usage analytics** — track which docs are most accessed

---

## 📞 Support

### When You Have a Documentation Question

1. **Check this index** — the tables above cover most topics
2. **Navigate to the relevant doc** — per tech stack
3. **Report problems** — flag issues or contact the maintainer
4. **Suggest improvements** — PRs and suggestions welcome

### Emergencies

1. **Deployment issues**: [`full-deployment-guide.md`](full-deployment-guide.md)
2. **Operations**: [`../RUNBOOK.md`](../RUNBOOK.md)

---

**Documentation system version: v1.0.0**  
**Created: 2026-03-26**  
**English version: 2026-06-04**  
**Based on: Flutter documentation pattern**
