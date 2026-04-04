// apps/api/src/client/kyc/dto/kyc-shared-enums.ts
/**
 * Re-exports + local const arrays for @lucky/shared enums used in KYC DTOs.
 *
 * WHY this file exists:
 *   The @nestjs/swagger CLI plugin resolves TypeScript `enum` references with
 *   ts-morph, tracing through ALL re-exports back to the original declaration
 *   file. For cross-workspace packages (e.g. @lucky/shared → ../../packages/shared),
 *   it generates a relative path computed from the SOURCE file depth, then writes
 *   it into the COMPILED dist/ file — which is one directory deeper due to
 *   `outDir: "./dist"`. Result: the require() path is always one `../` short.
 *
 *   FIX: pass a plain `const string[]` to `@ApiProperty({ enum: ... })`.
 *   The plugin does NOT trace const arrays — it uses the value as-is.
 *   The TypeScript `enum` type is still used for type-checking via normal import.
 */
export { KycIdCardType, toKycIdCardType } from '@lucky/shared';

/**
 * String values of KycIdCardType — pass this to @ApiProperty({ enum: ... })
 * instead of the enum class to avoid the plugin's broken cross-workspace require().
 */
export const KYC_ID_CARD_TYPE_VALUES = [
  'UNKNOWN',
  'PASSPORT',
  'PH_DRIVER_LICENSE',
  'PH_UMID',
  'PH_NATIONAL_ID',
  'PH_PRC_ID',
  'PH_POSTAL_ID',
  'CN_ID',
  'VN_ID',
] as const;
