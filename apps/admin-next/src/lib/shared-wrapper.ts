/**
 * ESM re-exports from @lucky/shared source files.
 *
 * @lucky/shared is built by esbuild to CJS with __reExport getter functions:
 *   __defProp(target, "TimeHelper", { get: () => TimeHelper })
 *
 * Turbopack cannot evaluate these getters in the client bundle — they resolve
 * to undefined at runtime.
 *
 * Fix: import directly from TypeScript source files via @lucky/shared/src/*.
 * Turbopack compiles the raw .ts, which has plain ESM exports — no getters,
 * no TDZ, no undefined.
 */

// ── Date / Number utilities ──
export { TimeHelper } from '@lucky/shared/src/date/TimeHelper';
export { CalcHelper } from '@lucky/shared/src/number/CalcHelper';
export { NumHelper } from '@lucky/shared/src/number/NumHelper';

// ── Coupon / Marketing ──
export {
  COUPON_TYPE,
  COUPON_TYPE_OPTIONS,
  DISCOUNT_TYPE,
  DISCOUNT_TYPE_OPTIONS,
  ISSUE_TYPE,
  ISSUE_TYPE_OPTIONS,
  VALID_TYPE,
  VALID_TYPE_OPTIONS,
} from '@lucky/shared/src/types/coupon';

// ── Finance / Wallet ──
export {
  TRANSACTION_TYPE,
  BALANCE_TYPE,
  DIRECTION,
  TRANSACTION_STATUS,
} from '@lucky/shared/src/types/wallet';

export {
  RECHARGE_STATUS,
  RECHARGE_STATUS_OPTIONS,
  WITHDRAW_STATUS,
  WITHDRAW_STATUS_OPTIONS,
  WITHDRAW_METHOD,
} from '@lucky/shared/src/types/finance';

// ── Order / Product ──
export { ORDER_STATUS } from '@lucky/shared/src/types/order';
export { GROUP_STATUS } from '@lucky/shared/src/types/treasure';

// ── Ads / Banners ──
export { JUMP_CATE } from '@lucky/shared/src/types/ad';

// ── Locale / i18n ──
export {
  AVAILABLE_LOCALES,
  DEFAULT_LOCALE,
} from '@lucky/shared/src/types/localized-string';

// ── KYC ──
export { KYC_STATUS } from '@lucky/shared/src/constants/kyc.constants';

// ── Type-only re-exports (resolved at compile-time, stripped at runtime) ──
export type { WithdrawStatus } from '@lucky/shared/src/types/finance';
export type { TransactionTypeValue } from '@lucky/shared/src/types/wallet';
export type { Locale, LocalizedString } from '@lucky/shared/src/types/localized-string';
