# Fix: Email Test OTP (999999) Not Working in Production

## Root Cause Analysis

The `EMAIL_OTP_TEST_EMAIL` environment variable is **missing** from the production configuration file [`deploy/.env.prod`](deploy/.env.prod:145).

### How the Feature Works

In [`apps/api/src/client/auth/auth.service.ts`](apps/api/src/client/auth/auth.service.ts:508-517), the `sendEmailLoginCode` method:

```typescript
const isProd = this.configService.get<string>('NODE_ENV') === 'production';
const testEmailsRaw = this.configService.get<string>('EMAIL_OTP_TEST_EMAIL') ?? '';
const testEmails = testEmailsRaw
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
const isTestEmail = testEmails.includes(normalizedEmail);
const code = isTestEmail
  ? '999999'
  : isProd
    ? gen6Code()
    : (this.configService.get<string>('EMAIL_OTP_DEV_CODE') ?? '666666');
```

Logic flow:
1. Reads `EMAIL_OTP_TEST_EMAIL` from env → splits by comma into an array of emails
2. If the requesting email matches any entry → **always** use `999999` (regardless of dev/prod)
3. If not a test email:
   - **Production**: generate a random 6-digit code
   - **Dev**: use `EMAIL_OTP_DEV_CODE` or `666666`

### Current State

| File | `EMAIL_OTP_TEST_EMAIL` | Works? |
|------|----------------------|--------|
| [`deploy/.env.dev`](deploy/.env.dev:143) | `mrsuperportertest@gmail.com` | ✅ Yes |
| [`deploy/.env.prod`](deploy/.env.prod:147) | **Missing** (not set) | ❌ No |

### Why It Fails on Production

Since `EMAIL_OTP_TEST_EMAIL` is not defined in production:
- `testEmailsRaw` → `''` (empty string)
- `testEmails` → `[]` (empty array)
- `isTestEmail` → `false`
- Since `isProd` is `true` → `gen6Code()` generates a **random** code
- The random code is sent via email (via Resend), but the user tries `999999` → verification fails

## Fix

**Add `EMAIL_OTP_TEST_EMAIL=mrsuperportertest@gmail.com`** to [`deploy/.env.prod`](deploy/.env.prod), right after line 146 (`# EMAIL_OTP_DEV_CODE=`):

```diff
 # ⚠️ 生产环境不要设置固定验证码，保持注释
 # EMAIL_OTP_DEV_CODE=
+EMAIL_OTP_TEST_EMAIL=mrsuperportertest@gmail.com
```

## Deployment Steps

1. Edit [`deploy/.env.prod`](deploy/.env.prod) and add the line above
2. Redeploy the API service so the new env var takes effect
3. Verify: request email login code for `mrsuperportertest@gmail.com` on production, use `999999` to log in

## Verification

After deploying, the flow should be:
1. POST `/v1/auth/email/send-code` with `email: mrsuperportertest@gmail.com`
2. Server reads `EMAIL_OTP_TEST_EMAIL` → finds `mrsuperportertest@gmail.com` in the list
3. `isTestEmail = true` → code = `999999`
4. Code `999999` is hashed and stored, and email is sent (with code `999999`)
5. POST `/v1/auth/email/login` with `code: 999999`
6. `verifyOtpHash` matches → login succeeds

### Note: Security Implication

This is designed as a **test bypass** — it allows the specified email to always use `999999` as the login code, skipping SMS/email delivery costs. The comment in `.env.prod` says "生产环境不要设置固定验证码" (don't set fixed codes in production), but the `EMAIL_OTP_TEST_EMAIL` feature was specifically built to allow this in production for testing purposes. If this is only meant for development, consider removing the test email after testing is done.
