# Fix Quill Rich Text Editor Toolbar CSS Not Loading

## Bug Summary

The Quill rich text editor's toolbar renders as raw HTML (unstyled buttons, pickers, etc.) because the dynamic CSS file fails to load from the CDN.

## Root Cause

In [`RichTextEditor.tsx`](apps/admin-blog/src/components/blog/RichTextEditor.tsx:56), the Quill snow theme CSS is loaded dynamically from:

```
https://cdn.jsdelivr.net/npm/react-quill-new@3.2.0/dist/quill.snow.css
```

**Two potential issues:**

1. **Version mismatch**: The installed package is [`react-quill-new@3.7.0`](apps/admin-blog/node_modules/react-quill-new/package.json:3) but the CDN URL hardcodes `@3.2.0`. Version `3.2.0` may not exist or may not have the `dist/quill.snow.css` file.

2. **Missing `dist/` folder**: The locally installed `react-quill-new@3.7.0` at [`apps/admin-blog/node_modules/react-quill-new/`](apps/admin-blog/node_modules/react-quill-new/) has a `lib/` directory (with `index.js`) but **NO `dist/` directory**. The `package.json` includes `"dist/"` in its `"files"` array, meaning it SHOULD be published to npm, but it's absent locally — suggesting the published npm package may also be missing the `dist/` folder.

   The build script ([`package.json`](apps/admin-blog/node_modules/react-quill-new/package.json:19)) copies CSS from `node_modules/quill/dist/quill.*.css*` to its own `dist/`, so the CSS originates from the `quill` base package.

## Fix Strategy

**Approach**: Change the CDN URL to load `quill.snow.css` directly from the [`quill`](node_modules/quill/package.json:3) base package (v2.0.3), which is the authoritative source for the Quill snow theme CSS.

Replace line 56:
```typescript
'https://cdn.jsdelivr.net/npm/react-quill-new@3.2.0/dist/quill.snow.css'
```
with:
```typescript
'https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.snow.css'
```

### Why This Works

- `quill` is the base package that owns `quill.snow.css` — it's the canonical source
- `react-quill-new` is just a React wrapper and copies the CSS from `quill` during its build
- Using the `quill` package directly bypasses any issues with `react-quill-new`'s build/publishing pipeline
- The version `2.0.3` matches what's installed locally

### Risk

- If `quill` v2.0.3's npm package also doesn't include a `dist/` directory with the compiled CSS, this URL would also fail. However, since `react-quill-new`'s build script explicitly copies from `node_modules/quill/dist/`, it's expected that `quill` publishes its compiled CSS in `dist/`.

## Alternative (Fallback)

If the above URL still doesn't work, copy `quill.snow.css` into the project's own `public/` directory and load it locally:

```typescript
link.href = '/css/quill.snow.css';
```

This eliminates CDN dependency entirely but requires maintaining the CSS file.

## Files to Modify

| File | Change |
|------|--------|
| [`apps/admin-blog/src/components/blog/RichTextEditor.tsx`](apps/admin-blog/src/components/blog/RichTextEditor.tsx:56) | Change CDN URL from `react-quill-new@3.2.0` to `quill@2.0.3` |
