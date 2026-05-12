# Fix: Swagger Export CI Failure — Missing `CF_R2_ACCESS_KEY_ID`

## Root Cause Analysis

### Error Chain

1. **CI workflow** ([`.github/workflows/deploy-swagger-docs.yml`](.github/workflows/deploy-swagger-docs.yml:80-86)) runs `yarn workspace @lucky/api export:swagger:full` on `ubuntu-latest` runner with these env vars:
   - `JWT_SECRET`, `DATABASE_URL`, `REDIS_URL`, `CF_R2_ACCOUNT_ID` (from secrets)
   - **Missing**: `CF_R2_ACCESS_KEY_ID`, `CF_R2_SECRET_ACCESS_KEY`

2. **Export script** ([`apps/api/scripts/cli/export-swagger.ts`](apps/api/scripts/cli/export-swagger.ts:177)) calls `loadEnvForHost()` which skips loading `.env.dev` because `DATABASE_URL` is already set in CI (`if (process.env.DATABASE_URL) return;` line 11).

3. **NestJS module compilation** instantiates all providers, including `UploadService`.

4. **UploadService constructor** ([`apps/api/src/common/upload/upload.service.ts`](apps/api/src/common/upload/upload.service.ts:48-50)) calls `this.configService.getOrThrow('CF_R2_ACCESS_KEY_ID')` — throws because this key is not in `process.env` in the CI runner.

### Why This Only Happens in CI

| Environment | `loadEnvForHost()` | `CF_R2_ACCESS_KEY_ID` | Result |
|---|---|---|---|
| Local dev | Loaded from `.env.dev` ✓ | Present ✓ | Works |
| CI (ubuntu-latest) | Skipped (DATABASE_URL present) | Missing ❌ | Fails |

## Proposed Fix

**Strategy**: Override `UploadService` with a mock in the export script, following the **exact same pattern** already used for `GoogleProvider` and `FirebaseProvider`.

The Swagger export script only needs NestJS **module metadata** (routes, DTOs, parameters) — it never calls actual service methods. Therefore, replacing `UploadService` with an empty mock is safe.

### Change: Add `overrideProvider(UploadService)` in export-swagger.ts

**File**: [`apps/api/scripts/cli/export-swagger.ts`](apps/api/scripts/cli/export-swagger.ts:196-203)

```typescript
const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(ConfigService)
    .useValue(configService)
    .overrideProvider(UploadService)    // ← ADD THIS
    .useValue({} as any)                // ← ADD THIS
    .overrideProvider(GoogleProvider)
    .useValue({} as any)
    .overrideProvider(FirebaseProvider)
    .useValue({} as any)
    .compile();
```

**Why this works**:
- Prevents `UploadService` constructor from being called during DI compilation
- Constructor is where all the `getOrThrow()` calls for R2 env vars live
- Other services that depend on `UploadService` (e.g., `KycProviderService`) will receive the mock, which is fine since they're also never called during export
- Follows established precedent in this same file (`GoogleProvider`, `FirebaseProvider`)

### Secondary Issue: Xendit Warning

The log `Invalid secret key provided. Please use your Xendit secret key that starts with 'xnd_'` comes from [`PaymentService`](apps/api/src/common/payment/payment.service.ts:18-21) initializing `new Xendit({secretKey: ''})`. This is a **non-fatal warning** — it logs but doesn't crash. No action needed.

## Files Changed

| File | Change |
|---|---|
| [`apps/api/scripts/cli/export-swagger.ts`](apps/api/scripts/cli/export-swagger.ts) | Add 2 lines: override `UploadService` with mock |

## Verification

After the fix, run the export command locally to confirm it works:

```bash
cd /Volumes/MySSD/work/JoyMini_Nest_Monorepo
yarn workspace @lucky/api export:swagger:full
```

Expected output: successful export to `apps/swagger-docs/` directory.
