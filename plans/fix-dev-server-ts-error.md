# Dev Server TypeScript Compilation Fix

## Root Cause

The NestJS dev server (`nest start --watch`) uses **incremental compilation** via `.tsbuildinfo` cache. When `turndown` was added to the project, the cache still contained the old compilation state (before turndown was imported). The incremental compilation tries to reuse the cached module graph, but the new `turndown` import wasn't in it, causing:

```
error TS2307: Cannot find module 'turndown' or its corresponding type declarations.
```

**`tsc --noEmit` works fine** because it does a full (non-incremental) compilation, resolving all modules from scratch.

## Fix

### Option 1: Clear cache and restart (simplest)

Delete the TypeScript incremental cache and restart the dev server:

```bash
# 1. Stop the dev server (Ctrl+C in the terminal)
# 2. Delete the cache file
find apps/api -name "*.tsbuildinfo" -delete

# 3. Restart
yarn workspace @lucky/api start:dev
```

### Option 2: Force full rebuild (alternative)

If the cache isn't the issue, force a clean rebuild:

```bash
# Stop dev server, then:
rm -rf apps/api/dist
yarn workspace @lucky/api start:dev
```

## Why This Happens

1. `yarn add turndown @types/turndown` installed packages in root `node_modules/` (yarn hoisting)
2. `tsc -p tsconfig.json --noEmit` runs a **full compilation** → resolves modules by walking up directory tree → works fine
3. `nest start --watch` uses **incremental compilation** → relies on cached `.tsbuildinfo` from before turndown existed → fails because the cached module graph doesn't include turndown

## Verification

After restart, the dev server should compile successfully. The turndown video fix (confirmed working in production) will also work locally.

## Current Status Summary

| Item | Status |
|------|--------|
| Turndown HTML→Markdown conversion | ✅ Implemented |
| Media placeholder extraction/restoration | ✅ Implemented |
| AI prompt placeholder preservation | ✅ Added to both batch + chunked prompts |
| Diagnostic logging (11 log points) | ✅ Added |
| Production deployment test | ✅ CONFIRMED WORKING (ErrorStrategy article, 17270 chars, 1 video preserved) |
| Dev server TypeScript compilation | ❌ Needs cache clear + restart |
