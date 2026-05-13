# Fix: ModalManager Context Isolation (useTranslations Error)

## Problem

[`ModalManager.open()`](packages/ui/src/components/Modal/modal-manager.tsx:6) uses `ReactDOM.createRoot(container)` to render modals in a **completely separate React root** appended to `document.body`. This root exists outside the main app's React component tree, so it has **no access to any React Context** — including `NextIntlClientProvider` which provides `useTranslations()` and `useLocale()`.

### Error Call Chain

1. [`GroupManagement.handleViewDetail`](apps/admin-next/src/components/groups/GroupManagementClient.tsx:241) calls `ModalManager.open({ renderChildren: () => <GroupDetailModalContent /> })`
2. `ModalManager.open()` creates a new React root outside the app tree
3. [`GroupDetailModalContent`](apps/admin-next/src/components/groups/GroupManagementClient.tsx:73) calls [`useTranslation()`](apps/admin-next/src/hooks/useTranslation.ts:25) → `useTranslations()`
4. `useTranslations()` throws: *"context from `NextIntlClientProvider` was not found"*

### Existing Workaround

Some components (e.g., [`WithdrawAuditModal`](apps/admin-next/src/views/finance/WithdrawAuditModal.tsx:33), [`BaseTable`](apps/admin-next/src/components/scaffold/BaseTable.tsx:212), [`Pagination`](apps/admin-next/src/components/scaffold/Pagination.tsx:19)) pass `tAction: TFunc` as a prop from the parent to avoid calling `useTranslation()` inside the modal. This is fragile — it requires every modal author to remember the workaround.

### Impact

Any `renderChildren` that uses hooks requiring React Context (next-intl, React Query, theme, etc.) inside a `ModalManager.open()` call will fail.

## Solution: Portal-based Modal System

Replace `ReactDOM.createRoot` with `ReactDOM.createPortal` by introducing a React Context Provider that mounts a portal container within the app's React tree.

### Architecture Diagram

```
app/layout.tsx
  <NextIntlClientProvider>              ← provides useTranslations context
    <ModalProvider>                     ← NEW: renders modal portal
      <I18nProvider>
        <Providers>
          {children}                    ← app content
        </Providers>
      </I18nProvider>
    </ModalProvider>
  </NextIntlClientProvider>

ModalProvider renders via createPortal:
  document.body
    <ModalFixed>                        ← has access to ALL React Contexts!
      <GroupDetailModalContent>
        useTranslation() → useTranslations() ✓ works!
```

### Files to Create

#### 1. [`packages/ui/src/components/Modal/modal-store.ts`](packages/ui/src/components/Modal/modal-store.ts) — NEW

Simple module-level store (zero external deps) using the publish-subscribe pattern:

- `modalStore.subscribe(cb)` — register listener for React `useSyncExternalStore`
- `modalStore.getState()` — returns current array of modal instances
- `modalStore.open(props)` — adds a modal instance, returns `{ close: () => void }`
- `modalStore.close(id)` — removes a modal instance by ID

#### 2. [`packages/ui/src/components/Modal/ModalProvider.tsx`](packages/ui/src/components/Modal/ModalProvider.tsx) — NEW

React component that:

- Uses `useSyncExternalStore` to subscribe to the modal store
- Renders active modals via `createPortal` into `document.body`
- Guards against SSR by checking `typeof document !== 'undefined'`
- Passes `onFinishClose` to each `ModalFixed` to clean up after exit animation

### Files to Modify

#### 3. [`packages/ui/src/components/Modal/modal-manager.tsx`](packages/ui/src/components/Modal/modal-manager.tsx) — MODIFY

Replace `ReactDOM.createRoot` / `root.unmount()` with `modalStore.open(props)` / `store.close(id)`:

```ts
// Before
const root = ReactDOM.createRoot(container);
root.render(<ModalFixed {...props} onFinishClose={destroy} />);
return { close: destroy };

// After
return modalStore.open(props);  // same return type { close: () => void }
```

#### 4. [`packages/ui/src/components/index.ts`](packages/ui/src/components/index.ts) — MODIFY

Add `export * from "./Modal/ModalProvider.tsx";`

#### 5. [`apps/admin-next/src/app/layout.tsx`](apps/admin-next/src/app/layout.tsx) — MODIFY

Add `<ModalProvider />` inside `<NextIntlClientProvider>` so modals have access to i18n context:

```tsx
<NextIntlClientProvider locale={locale} messages={messages}>
  <ModalProvider />          {/* ← ADD HERE */}
  <I18nProvider>
    ...
  </I18nProvider>
</NextIntlClientProvider>
```

### Benefits

| Aspect | Before (createRoot) | After (createPortal) |
|--------|-------------------|--------------------|
| React Context | ❌ Not available | ✅ All contexts available |
| SSR Safety | ✅ N/A (client-only) | ✅ Guarded by `typeof document` check |
| API Backward Compat | ✅ — | ✅ Same `ModalManager.open()` signature |
| Return Type | `{ close: destroy }` | ✅ Same `{ close: () => void }` |
| Exit Animations | ✅ Works | ✅ Works (same ModalFixed) |
| Multiple Modals | ✅ Separate roots | ✅ Single portal, per-instance state |

### Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| SSR: `document.body` undefined | `typeof document === 'undefined'` guard returns null |
| Modal close skips animation | Same behavior as current `destroy()` — immediate unmount via `close()` |
| Multiple modals interfere | Each `ModalFixed` manages its own `visible` state independently |
| Module-level store is global singleton | Same pattern as current `ModalManager` singleton — acceptable for UI state |
