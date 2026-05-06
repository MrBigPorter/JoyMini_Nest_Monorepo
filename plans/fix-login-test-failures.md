# Fix Login.test.tsx Test Failures

## Problem

3 tests in [`apps/admin-next/src/__tests__/views/Login.test.tsx`](apps/admin-next/src/__tests__/views/Login.test.tsx) are failing in CI:

1. `calls authApi.login with correct credentials on valid submit`
2. `stores token and redirects to / on success`
3. `shows error toast on login failure (no access token)`

## Root Cause

The [`Login.tsx`](apps/admin-next/src/views/Login.tsx:131-143) component's `onSubmit` handler adds a `recaptchaToken` field to the data before calling `runAsync`:

```ts
const onSubmit = async (data: LoginFormInputs) => {
  let recaptchaToken = '';
  if (executeRecaptcha) {
    recaptchaToken = await executeRecaptcha('admin_login');
  }
  await runAsync({
    ...data,
    username: sanitizeInput(data.username),
    recaptchaToken,   // ← this extra field
  });
};
```

The component uses `useGoogleReCaptcha` from `react-google-recaptcha-v3`:

```ts
import { useGoogleReCaptcha } from 'react-google-recaptcha-v3';
// ...
const { executeRecaptcha } = useGoogleReCaptcha();
```

However, [`Login.test.tsx`](apps/admin-next/src/__tests__/views/Login.test.tsx) does **not** mock `react-google-recaptcha-v3`. Since `executeRecaptcha` is `undefined` (falsy), `recaptchaToken` stays as `''` and gets included in the `authApi.login()` call.

### Why each test fails

**Test 1** — `calls authApi.login with correct credentials on valid submit`:
- Expects `mockAuthLogin` called with `{ username: 'admin', password: 'password123' }`
- Actual call: `{ username: 'admin', password: 'password123', recaptchaToken: '' }`
- `toHaveBeenCalledWith` uses exact deep-equality match → fails due to extra `recaptchaToken` property

**Test 2** — `stores token and redirects to / on success`:
- Even though it doesn't assert `mockAuthLogin` args directly, this test may also fail because:
  - The `waitFor` retries all assertions; if the mock resolves successfully but React transition scheduling is async, the assertions may not be satisfied in time
  - However, since the mock DOES resolve (extra args don't break resolution), this test **should** pass if `onSuccess` fires correctly. The failure is likely due to `waitFor` timeout because transitions/flushes don't happen synchronously in jsdom.

**Test 3** — `shows error toast on login failure (no access token)`:
- Similar to test 2; the mock resolves, `onSuccess` fires with `accessToken: ''`, so the `else` branch adds an error toast
- Same timing issue as test 2

### Precedent for the fix

[`RegisterApply.test.tsx`](apps/admin-next/src/__tests__/views/RegisterApply.test.tsx:25-29) already correctly mocks `react-google-recaptcha-v3`:

```ts
const mockExecuteRecaptcha = vi.hoisted(() => vi.fn());

vi.mock('react-google-recaptcha-v3', () => ({
  useGoogleReCaptcha: () => ({
    executeRecaptcha: mockExecuteRecaptcha,
  }),
}));
```

## Fix Plan

### Step 1 — Add `react-google-recaptcha-v3` mock to Login.test.tsx

Following the pattern in `RegisterApply.test.tsx`:

1. Add a hoisted `mockExecuteRecaptcha` variable alongside existing hoisted mocks (line ~11)
2. Add a `vi.mock('react-google-recaptcha-v3', ...)` block that returns `executeRecaptcha: mockExecuteRecaptcha`

```ts
const mockExecuteRecaptcha = vi.hoisted(() => vi.fn());

vi.mock('react-google-recaptcha-v3', () => ({
  useGoogleReCaptcha: () => ({
    executeRecaptcha: mockExecuteRecaptcha,
  }),
}));
```

### Step 2 — Configure mock return values in each test

For the 3 failing tests (and any other test that needs it), configure `mockExecuteRecaptcha`:

- No change needed for tests 1-3: `mockExecuteRecaptcha` (a `vi.fn()`) returns `undefined` by default when called. In the `onSubmit` handler, `if (executeRecaptcha)` passes (truthy function), `await executeRecaptcha(...)` returns `undefined`. When spread: `{ ...data, recaptchaToken: undefined }` — vitest's `toEqual` treats `undefined` properties equivalent to missing ones, so the existing assertions will pass.

### Step 3 — Update test expectations (if needed after Step 2)

If tests still fail after Step 2, update the assertions in tests 1-3 to include `recaptchaToken`:

```ts
expect(mockAuthLogin).toHaveBeenCalledWith({
  username: 'admin',
  password: 'password123',
  recaptchaToken: undefined,
});
```

But this is likely unnecessary since `toEqual` in vitest treats `undefined` properties as equivalent to missing ones.

## Files to Modify

| File | Change |
|------|--------|
| [`apps/admin-next/src/__tests__/views/Login.test.tsx`](apps/admin-next/src/__tests__/views/Login.test.tsx) | Add `react-google-recaptcha-v3` mock (Steps 1-2) |
