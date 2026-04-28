# Admin Blog ESLint Fix Plan

## Problem

`yarn workspace @lucky/admin-blog lint` (alias: `next lint`) fails in CI because:

- Missing `.eslintrc.cjs` → `next lint` prompts interactively for ESLint setup
- `admin-next` and `frontend-blog` both have `.eslintrc.cjs` + `.eslintignore`
- CI cannot handle interactive prompts → exits with error

## Solution

Create two files for `admin-blog`, modeled after `admin-next`:

### 1. `apps/admin-blog/.eslintrc.cjs`

Copy from `apps/admin-next/.eslintrc.cjs` since both are Next.js admin apps with identical patterns (Sentry, lucide-react, framer-motion, etc.)

### 2. `apps/admin-blog/.eslintignore`

Copy from `apps/admin-next/.eslintignore` — standard Next.js build output ignores.

## Verification

- `yarn workspace @lucky/admin-blog lint` should exit 0 (or only warnings)
- CI lint step should no longer hang on interactive prompt
