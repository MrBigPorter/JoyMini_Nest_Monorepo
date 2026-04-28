# Localized Form Fix Plan: Solving the `[object Object]` Issue

## Problem Analysis

### Current Issue

When `BlogCategoryModal` opens with a multilingual object value like `{zh: '名称', en: 'name'}`, the `setTimeout` in `useLocalizedForm.ts` causes a timing issue where React renders the object before it's converted to a string, resulting in `[object Object]` appearing in the input field.

### Root Cause

1. **Timing Gap**: The `setTimeout(() => setValue(...), 0)` creates a race condition
2. **React Render Cycle**: React completes rendering before the `setValue` executes
3. **HTML Input Behavior**: HTML `input` elements call `Object.toString()` on object values
4. **Inconsistent Handling**: `BlogArticleModal` works correctly because it uses `extractStringValue` before `reset()`

### Affected Components

- `BlogCategoryModal.tsx` - Shows `[object Object]` issue
- `BlogTagModal.tsx` - Likely has same issue
- `BlogCommentModal.tsx` - Likely has same issue
- Any other modal using `useLocalizedForm` with object initial values

## Solution Architecture

### Two-Pronged Approach

#### 1. Fix at Hook Level (`useLocalizedForm.ts`)

**Goal**: Eliminate the `setTimeout` race condition by handling object conversion synchronously

**Changes**:

- Remove `setTimeout` from object initialization
- Use immediate `setValue` with proper options
- Enhance `getSafeValue()` to handle objects more robustly
- Add synchronous object detection and conversion

#### 2. Fix at Modal Level (All affected modals)

**Goal**: Ensure consistent data flow by normalizing values before they enter RHF

**Changes**:

- Update `getDefaultValues()` to extract current locale strings
- Use `extractCurrentLocaleValue()` utility function
- Ensure RHF only receives string values, not objects

### Data Flow Diagram

```mermaid
graph TD
    A[API Returns Object<br/>{zh: '名称', en: 'name'}] --> B[Modal getDefaultValues]

    B --> C{Current Approach}
    C --> D[Pass Object to reset<br/>Causes [object Object]]

    B --> E{Proposed Fix}
    E --> F[Extract Current Locale String<br/>'名称' or 'name']
    F --> G[Pass String to reset]

    G --> H[RHF Stores String]
    H --> I[useLocalizedForm localize<br/>Returns String Value]
    I --> J[Input Displays Correct Text]

    D --> K[useLocalizedForm setTimeout<br/>Race Condition]
    K --> L[Input Shows [object Object]]
```

## Implementation Plan

### Phase 1: Core Hook Fix

1. **Modify `useLocalizedForm.ts`**:
   - Remove `setTimeout` from lines 121-127
   - Replace with immediate `setValue` call
   - Add synchronous object detection in `getSafeValue()`
   - Ensure `value` prop always returns string

2. **Update Utility Functions**:
   - Enhance `extractCurrentLocaleValue()` in `localizedForm.ts`
   - Create helper for safe object-to-string conversion

### Phase 2: Modal Updates

1. **Update `BlogCategoryModal.tsx`**:
   - Modify `getDefaultValues()` to use `extractCurrentLocaleValue()`
   - Ensure string values are passed to `reset()`

2. **Update `BlogTagModal.tsx`**:
   - Apply same pattern as CategoryModal

3. **Update `BlogCommentModal.tsx`**:
   - Apply same pattern (check if affected)

### Phase 3: Testing & Validation

1. **Test Scenarios**:
   - Edit existing category with multilingual name
   - Create new category
   - Switch languages while editing
   - Form submission and data persistence

2. **Validation Criteria**:
   - No `[object Object]` appears in inputs
   - Language switching works correctly
   - Form data persists correctly
   - No console errors or warnings

## Technical Implementation Details

### Hook-Level Fix (`useLocalizedForm.ts`)

**Current Problem Code**:

```typescript
// Line 121-127
setTimeout(() => {
  setValue(fieldName as any, langValue, {
    shouldDirty: false,
    shouldTouch: false,
    shouldValidate: false,
  });
}, 0);
```

**Proposed Fix**:

```typescript
// Immediate setValue with proper options
setValue(fieldName as any, langValue, {
  shouldDirty: false,
  shouldTouch: false,
  shouldValidate: false,
});
```

**Enhanced `getSafeValue()`**:

```typescript
const getSafeValue = () => {
  // Immediate object detection and conversion
  if (rawValue && typeof rawValue === "object" && !(rawValue instanceof File)) {
    const langValue = (rawValue as Record<string, any>)[locale];
    if (langValue !== null && langValue !== undefined) {
      return String(langValue);
    }
    // Fallback logic...
  }
  // Existing logic...
};
```

### Modal-Level Fix (`BlogCategoryModal.tsx`)

**Current `getDefaultValues()`**:

```typescript
return {
  ...editingCategory,
  name: normalizeLocalizedValue(editingCategory.name),
  description: normalizeLocalizedValue(editingCategory.description),
};
```

**Proposed Fix**:

```typescript
return {
  ...editingCategory,
  name: extractCurrentLocaleValue(editingCategory.name, locale),
  description: extractCurrentLocaleValue(editingCategory.description, locale),
  slug: editingCategory.slug || "",
};
```

## Risk Assessment

### Potential Risks

1. **Breaking Changes**: Removing `setTimeout` might cause React render warnings
2. **Language Switching**: Need to ensure locale changes still work correctly
3. **Form State**: `shouldDirty` and `shouldTouch` flags must be set appropriately

### Mitigation Strategies

1. **Incremental Changes**: Fix one component at a time
2. **Comprehensive Testing**: Test all edge cases
3. **Fallback Logic**: Keep existing fallback mechanisms intact

## Success Metrics

1. **Primary**: No `[object Object]` appears in any form input
2. **Secondary**: Language switching works seamlessly
3. **Tertiary**: Form submission retains all language data
4. **Performance**: No degradation in form responsiveness

## Timeline & Dependencies

### Dependencies

- React Hook Form v7+ compatibility
- Existing `useLanguage()` hook for locale detection
- Current `normalizeLocalizedValue()` utility function

### Testing Requirements

- Manual testing of all affected modals
- Verify no regression in `BlogArticleModal`
- Cross-browser testing (Chrome, Firefox, Safari)
- Mobile responsiveness check

## Conclusion

This comprehensive fix addresses the root cause at both the hook and component levels, ensuring robust handling of multilingual form data while maintaining backward compatibility and user experience.
