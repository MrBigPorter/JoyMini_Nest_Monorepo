# Fix OAuth Callback Page Lint/TS Errors

## Issues Found

All issues are in [`apps/frontend-blog/src/app/oauth/callback/page.tsx`](apps/frontend-blog/src/app/oauth/callback/page.tsx).

| # | Issue | Count | Root Cause |
|---|-------|-------|------------|
| 1 | `TS2322: Type '{}' is not assignable to type 'string'` | 12 | `decodeJWT` returns `Record<string, unknown>` but `.sub`, `.name`, `.picture`, `.email` don't exist on that type |
| 2 | `syncTheme` is declared but never used | 1 | The function (lines 53-77) is dead code — theme is handled by inline script in layout.tsx |
| 3 | `Unexpected any` (`@typescript-eslint/no-explicit-any`) | 8 | `catch (err: any)` blocks and `locale as any` casts |
| 4 | Missing useEffect dependencies | 1 | `handleGoogleLogin/FacebookLogin/GenericLogin` used inside effect but not in deps array |
| 5 | Duplicated code fragment (19 lines) | 3 | Three nearly identical OAuth handler functions |
| 6 | Promise returned from handleCallback is ignored | 1 | `handleCallback()` on line 160 without `void` or `.catch()` |

## Proposed Fixes

### Fix 1: Define proper `JWTPayload` interface (resolves issues 1 + 3)

Replace `Record<string, unknown> | null` with a proper type:

```typescript
interface JWTPayload {
  sub?: string;
  name?: string;
  picture?: string;
  email?: string;
  [key: string]: unknown; // allow other JWT claims
}

function decodeJWT(token: string): JWTPayload | null {
  // ... same implementation, just different return type
}
```

### Fix 2: Remove unused `syncTheme` function (resolves issue 2)

Delete lines 53-77 entirely. The inline script in [`layout.tsx`](apps/frontend-blog/src/app/layout.tsx:22-38) already handles theme synchronization.

### Fix 3: Replace `any` with proper types (resolves issue 3)

- `catch (err: any)` → `catch (err: unknown)` with `err instanceof Error ? err.message : '...'`
- `locale as any` → `locale as SupportedLocale` (import `SupportedLocale` from `@/lib/utils/locale`)

### Fix 4: Refactor duplicated handlers (resolves issues 4 + 5 + 6)

Merge `handleGoogleLogin`, `handleFacebookLogin`, `handleGenericLogin` into a single `handleOAuthLogin` function. Since this function can then be defined stably, the missing deps warning and code duplication are both resolved.

```typescript
const PROVIDER_CONFIG = {
  google: { defaultNickname: 'Google User', defaultId: 'unknown-google-user' },
  facebook: { defaultNickname: 'Facebook User', defaultId: 'unknown-facebook-user' },
  generic: { defaultNickname: 'OAuth User', defaultId: 'unknown-oauth-user' },
} as const;

type OAuthProvider = keyof typeof PROVIDER_CONFIG;

const handleOAuthLogin = useCallback(async (
  token: string,
  refreshToken: string,
  provider: OAuthProvider,
) => {
  // ... shared logic using PROVIDER_CONFIG[provider]
}, [store, router]);
```

The effect then calls:
```typescript
void handleOAuthLogin(token, refreshToken, provider as OAuthProvider);
```

And the promise is handled with `void`.

## Files to Modify

| File | Changes |
|------|---------|
| [`apps/frontend-blog/src/app/oauth/callback/page.tsx`](apps/frontend-blog/src/app/oauth/callback/page.tsx) | All 6 fixes above |

## Execution Order

1. Add `JWTPayload` interface and update `decodeJWT` return type
2. Remove unused `syncTheme` function
3. Add import for `SupportedLocale` and `useCallback`
4. Refactor 3 handlers into single `handleOAuthLogin` with `useCallback` + PROVIDER_CONFIG map
5. Fix `catch (err: any)` → `unknown` in all 4 locations
6. Fix `locale as any` → `as SupportedLocale` in all 4 locations
7. Add `void` to `handleCallback()` call
8. Run `yarn workspace @lucky/frontend-blog check-types` to verify zero TS errors
9. Run `yarn workspace @lucky/frontend-blog lint` to verify zero lint warnings
