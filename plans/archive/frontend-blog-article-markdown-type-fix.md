# fix: TypeScript errors in `ArticleMarkdown.tsx` from React 19 types migration

## Root cause

The CI is failing with 3 TypeScript errors in [`ArticleMarkdown.tsx`](apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx):

```
Error: src/components/blog/ArticleMarkdown.tsx(433,34): error TS2339: Property 'className' does not exist on type '{}'.
Error: src/components/blog/ArticleMarkdown.tsx(436,34): error TS2339: Property 'node' does not exist on type '{}'.
Error: src/components/blog/ArticleMarkdown.tsx(437,47): error TS2339: Property 'node' does not exist on type '{}'.
```

### Why this happens

The code lives inside the `hasBlockElement` function at line 407:

```ts
const hasBlockElement = (child: any): boolean => {
  // ...
  if (isValidElement(child)) {
    // child is now narrowed to ReactElement<P>
    const type = child.type as any;
    // ...
    if (child.props?.className?.includes('article-media-wrapper'))  // line 433
      return true;
    if (child.props?.node?.tagName) {                                // line 436
      const tagName = child.props.node.tagName.toLowerCase();        // line 437
```

The project upgraded to **React 19** (`"react": "^19.0.0"`, `"@types/react": "^19.0.0"`). In React 19 types, two key changes cause this:

1. **`ReactElement<P = unknown>`** — the `props` generic default changed from `any` (React 18) to `unknown` (React 19).

2. **`isValidElement<P>(object: {} | null | undefined): object is ReactElement<P>`** — has **no default** for `P`.

When `isValidElement(child)` is called with `child: any`, TypeScript cannot infer `P` from the parameter type (`{} | null | undefined`), so `P` resolves to `unknown`. Consequently, `child.props` becomes `unknown`, and accessing `.className` or `.node` on it raises TS2339 — the compiler reports the type as `{}` (the effective empty object type when `unknown` is used in this context).

## Fix

The `child` function parameter is already typed as `any`, but `isValidElement()` narrows it away from `any`. The fix is to explicitly **re-cast `child` to `any`** after the `isValidElement` guard, preserving the original intent while satisfying the type checker.

### Changes to make

In [`apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx`](apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx), inside `hasBlockElement`, replace the `isValidElement(child)` block (lines 414-449) with:

```ts
if (isValidElement(child)) {
  const el = child as any;
  // Check if React element is a block-level component
  const type = el.type as any;
  if (typeof type === 'string') {
    return [
      'div', 'video', 'figure', 'table', 'pre',
      'iframe', 'blockquote', 'ul', 'ol',
    ].includes(type);
  }
  // Check if it's our HlsVideoPlayer or wrapped component
  if (type?.name === 'HlsVideoPlayer') return true;
  // Check className for our wrapper
  if (el.props?.className?.includes('article-media-wrapper')) return true;
  // Check if child has a node prop (from rehypeRaw) with a block-level tagName
  if (el.props?.node?.tagName) {
    const tagName = el.props.node.tagName.toLowerCase();
    return [
      'div', 'video', 'figure', 'table', 'pre',
      'iframe', 'blockquote', 'ul', 'ol',
    ].includes(tagName);
  }
}
```

This is a **type-only change** — runtime behavior is identical. The `el` variable is cast to `any`, so TypeScript allows all property accesses.

## Verification

After applying the fix, run from the monorepo root:

```bash
yarn turbo run check-types --filter=@lucky/frontend-blog
```

Or equivalently from `apps/frontend-blog`:

```bash
cd apps/frontend-blog && yarn check-types
```
