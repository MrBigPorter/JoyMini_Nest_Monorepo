# Fix Lint Errors in @lucky/admin-blog

## Analysis

Running `yarn workspace @lucky/admin-blog lint` produces:

### Error 1: [`page.tsx`](<apps/admin-blog/src/app/(dashboard)/blog/articles/page.tsx:485>) — Prettier formatting errors (lines 485-527)

The `requestArticles` useCallback block (added/altered recently to include `renderLocalizedText` in the `.map()`) has incorrect indentation throughout. Prettier (configured with `printWidth: 80`, `tabWidth: 2`, `singleQuote: true`, `trailingComma: "all"`) expects different line wrapping and indentation, particularly around:

- The `.map((article: Article) => ({...}))` callback body (lines 500-517)
- The inner `.map((tag: ...) => ...)` chain (lines 510-516)
- The closing `}),` at line 515
- The `return { data, total, success }` block (lines 520-524)
- The `catch` block (lines 525-529)

**Fix**: Run `prettier --write` on the file to auto-format all issues.

### Warning 2: [`SmartImage.tsx`](apps/admin-blog/src/components/ui/SmartImage.tsx:91) — `<img>` element (not error, just warning)

`@next/next/no-img-element` warns about using `<img>` instead of Next.js `<Image>`. The existing code comment explains this is intentional: local images (`blob:` / `data:` URIs) cannot use `@unpic/react` or Next.js `Image`. This is configured as `'warn'` in `.eslintrc.cjs`, so it won't fail CI.

**Fix**: Add `// eslint-disable-next-line @next/next/no-img-element` before the `<img>` tag to suppress the warning explicitly.

## Plan

| #   | Step                                           | Description                                                                |
| --- | ---------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | Run `prettier --write` on `page.tsx`           | Auto-fix all 30+ prettier formatting errors in the `requestArticles` block |
| 2   | Add eslint-disable comment in `SmartImage.tsx` | Suppress the intentional `<img>` warning                                   |
| 3   | Re-run lint to verify                          | Confirm all errors are resolved, only expected warnings remain             |
