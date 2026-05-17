# RN Design Token Refactor — Match Flutter Pattern

## Goal

Replace the current complex multi-file theme system with a single clean API matching Flutter:

```dart
// Flutter (current)
context.textPrimary900    // theme-aware color
context.spacingXs         // = 4.w
context.radiusSm          // = 6.r
context.textXs            // = 12.sp
```

```tsx
// RN (target)
front.w10                 // = 40 (spacing, static)
front.primary             // = brand primary color (theme-aware via useFront())
front.textSm              // = 14 (font size, static)
front.radiusMd            // = 8 (border radius, static)
```

---

## Current Flutter Architecture

The Flutter auto-generated file [`design_tokens.g.dart`](Users/porter/Developer/JoyMini_Flutter_App/lib/theme/design_tokens.g.dart) has three parts:

### 1. `TokensLight` (387 lines)
Static class with light-mode color constants:
```dart
class TokensLight {
  static const Color textPrimary900 = Color(0xff181d27);
  static const Color bgPrimary = Color(0xffffffff);
  static const Color fgBrandPrimary = Color(0xfffc7701);
  // ... ~380 more
}
```

### 2. `TokensDark` (383 lines)
Same structure, dark-mode values:
```dart
class TokensDark {
  static const Color textPrimary900 = Color(0xfff7f7f7);
  static const Color bgPrimary = Color(0xff22262f);
  static const Color fgBrandPrimary = Color(0xfffc7701);
  // ... ~380 more
}
```

### 3. `extension TokensX on BuildContext` (~460 lines)
Extension methods on `BuildContext` that resolve to correct mode:
- Colors: `context.textPrimary900`, `context.bgPrimary`, `context.fgBrandPrimary`  
- Spacing: `context.spacingXs` (4.w), `context.spacingMd` (8.w), `context.spacing5xl` (40.w)
- Radius: `context.radiusSm` (6.r), `context.radiusMd` (8.r)
- Font sizes: `context.textXs` (12.sp), `context.textSm` (14.sp)
- Widths: `context.widthXxs` (320.w)
- Containers: `context.containerMaxWidthDesktop` (1280.w)

---

## Proposed RN Architecture

Replace 5 files + 1 generator with a simpler setup:

### `tool/gen_tokens_rn.mjs` (REWRITTEN)
Outputs a single generated file with:

**1. `TokensLight` namespace object**
```ts
export const TokensLight = {
  textPrimary900: '#181d27',
  bgPrimary: '#ffffff',
  fgBrandPrimary: '#fc7701',
  // ... all light mode colors
} as const;
```

**2. `TokensDark` namespace object**
```ts
export const TokensDark = {
  textPrimary900: '#f7f7f7',
  bgPrimary: '#22262f',
  fgBrandPrimary: '#fc7701',
  // ... all dark mode colors
} as const;
```

**3. `front` — static design tokens object**
```ts
export const front = {
  // ── Spacing (by numeric value name) ──
  w0: 0,        // spacing_none
  w2: 2,        // spacing_xxs
  w4: 4,        // spacing_xs
  w6: 6,        // spacing_sm
  w8: 8,        // spacing_md
  w12: 12,      // spacing_lg
  w16: 16,      // spacing_xl
  w20: 20,      // spacing_2xl
  w24: 24,      // spacing_3xl
  w32: 32,      // spacing_4xl
  w40: 40,      // spacing_5xl
  w48: 48,      // spacing_6xl
  w64: 64,      // spacing_7xl
  w80: 80,      // spacing_8xl
  w96: 96,      // spacing_9xl
  
  // ── Radius ──
  radiusNone: 0,
  radiusXxs: 2,
  radiusXs: 4,
  radiusSm: 6,
  radiusMd: 8,
  radiusLg: 10,
  radiusXl: 12,
  radius2xl: 16,
  radius3xl: 20,
  radius4xl: 24,
  radiusFull: 9999,
  
  // ── Font sizes ──
  text3xs: 8,
  text2xs: 10,
  textXs: 12,
  textSm: 14,
  textMd: 16,
  textLg: 18,
  textXl: 20,
  displayXs: 24,
  displaySm: 30,
  displayMd: 36,
  displayLg: 48,
  displayXl: 60,
  display2xl: 72,
  
  // ── Line heights ──
  // (mapped from tokens)
  
  // ── Widths ──
  widthXxs: 320,
  widthXs: 384,
  widthSm: 480,
  widthMd: 560,
  widthLg: 640,
  widthXl: 768,
  // ...
  
  // ── Container ──
  containerMaxWidthDesktop: 1280,
  containerPaddingDesktop: 32,
  containerPaddingMobile: 16,
  
  // ── Semantic spacing aliases ──
  spacingNone: 0,
  spacingXxs: 2,
  spacingXs: 4,
  spacingSm: 6,
  spacingMd: 8,
  spacingLg: 12,
  spacingXl: 16,
  spacing2xl: 20,
  spacing3xl: 24,
  spacing4xl: 32,
  spacing5xl: 40,
  spacing6xl: 48,
  spacing7xl: 64,
  spacing8xl: 80,
  spacing9xl: 96,
} as const;
```

**4. `useFront()` — hook that returns `front` + theme-aware colors**
```ts
export function useFront(): typeof front & {
  // Theme-aware colors (resolved to current mode)
  primary: string;
  textPrimary: string;
  textSecondary: string;
  bgPrimary: string;
  fgBrandPrimary: string;
  // ... all mode-specific token names from TokensLight/TokensDark
} {
  const { mode } = useTheme();
  return useMemo(() => ({
    ...front,
    // Resolve all color tokens to current mode
    ...Object.fromEntries(
      Object.entries(TokensLight).map(([key]) => [
        key,
        mode === 'dark' ? (TokensDark as any)[key] : (TokensLight as any)[key],
      ])
    ),
  }), [mode]);
}
```

---

## Usage Examples

```tsx
import { front, useFront } from '@/lib/theme';

// ── Static tokens (no hook needed) ──
style={{ gap: front.w8, padding: front.w16 }}
fontSize={front.textSm}
borderRadius={front.radiusMd}
width={front.widthSm}

// ── Theme-aware colors (via hook) ──
function MyComponent() {
  const f = useFront();
  
  return (
    <View style={{ backgroundColor: f.bgPrimary }}>
      <Text style={{ color: f.textPrimary900, fontSize: front.textSm }}>
        Hello
      </Text>
    </View>
  );
}
```

---

## Files to Modify

| File | Action |
|------|--------|
| [`tool/gen_tokens_rn.mjs`](../frontend-blog-mobile/tool/gen_tokens_rn.mjs) | **Rewrite** — generate `TokensLight`, `TokensDark`, `front`, `useFront` instead of current output |
| [`design_tokens.g.ts`](../frontend-blog-mobile/src/lib/theme/design_tokens.g.ts) | **Regenerate** (via gen_tokens_rn.mjs) |
| [`ThemeContext.tsx`](../frontend-blog-mobile/src/lib/theme/ThemeContext.tsx) | **Simplify** — keep just mode state + `useTheme()`; remove `buildModeColorMap`, `useModeColors` (replaced by `useFront`) |
| [`colors.ts`](../frontend-blog-mobile/src/lib/theme/colors.ts) | **Keep as backward-compat shim** (re-export from generated) |
| [`spacing.ts`](../frontend-blog-mobile/src/lib/theme/spacing.ts) | **Keep as backward-compat shim** (re-export from generated) |
| [`typography.ts`](../frontend-blog-mobile/src/lib/theme/typography.ts) | **Keep as backward-compat shim** (re-export from generated) |
| [`index.ts`](../frontend-blog-mobile/src/lib/theme/index.ts) | **Update** — export `front`, `useFront`, `TokensLight`, `TokensDark` |

---

## Key Design Decisions

1. **`w` prefix for spacing**: Matches the numeric naming from design tokens (`10 (40px)` → `w10` → `40`). Like Tailwind's `w-10` but without the dash.

2. **Static `front` + hook `useFront()`**: Spacing/radius/fonts never change with theme, so they're statically importable. Only colors need the hook.

3. **Backward compatibility**: Old exports (`colors.primary`, `spacing.md`, `typography.h1`) still work via shim files, so existing code doesn't break.

4. **No if/ternary**: `useFront().primary` automatically resolves to the correct light/dark value — zero conditionals at the call site.

---

## Migration Path

Current code → minimal changes:
```tsx
// BEFORE
const { colors } = useTheme();
<View style={{ backgroundColor: colors.bg_primary }}>
  <Text style={{ color: colors.text_primary_900, fontSize: typography.sm }}>
    Hello
  </Text>
</View>

// AFTER
const f = useFront();
<View style={{ backgroundColor: f.bgPrimary }}>
  <Text style={{ color: f.textPrimary900, fontSize: front.textSm }}>
    Hello
  </Text>
</View>
```

The camelCase names match the Flutter convention (`textPrimary900` not `text_primary_900`), making cross-reference between platforms natural.
