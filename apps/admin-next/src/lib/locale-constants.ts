/**
 * Local constants — local copy to avoid Turbopack's CJS barrel TDZ issue.
 *
 * When esbuild compiles TypeScript to CommonJS, it generates:
 *   __export(target, { X: () => X })
 *   const X = "value";
 *
 * The arrow function `() => X` is used as a property getter. Turbopack's
 * static analysis eagerly evaluates this getter before `const X` is
 * initialized, hitting the Temporal Dead Zone (TDZ) → ReferenceError.
 *
 * By defining these constants locally, we bypass the CJS barrel entirely.
 * Keep these values in sync with packages/shared/src/ source files.
 */

// ── l18n ────────────────────────────────────────────────────────────
// Sync with: packages/shared/src/types/localized-string.ts
export const DEFAULT_LOCALE = 'zh' as const;

export const AVAILABLE_LOCALES = ['zh', 'en', 'ja', 'ko', 'fr', 'de'] as const;

export type Locale = (typeof AVAILABLE_LOCALES)[number];

// ── Treasure / Products ─────────────────────────────────────────────
// Sync with: packages/shared/src/types/treasure.ts
export const TREASURE_STATE = {
  ACTIVE: 1,
  INACTIVE: 0,
} as const;

export const TreasureFilterType = {
  ALL: 'ALL',
  ON_SALE: 'ON_SALE',
  PRE_SALE: 'PRE_SALE',
  NOT_EXPIRED: 'NOT_EXPIRED',
} as const;

export type TreasureFilterType =
  (typeof TreasureFilterType)[keyof typeof TreasureFilterType];

export const GROUP_STATUS = {
  ACTIVE: 1,
  SUCCESS: 2,
  FAILED: 3,
} as const;

// ── KYC ─────────────────────────────────────────────────────────────
// Sync with: packages/shared/src/constants/kyc.constants.ts
export const KYC_STATUS = {
  DRAFT: 0,
  REVIEWING: 1,
  REJECTED: 2,
  NEED_MORE: 3,
  APPROVED: 4,
  AUTO_REJECTED: 5,
} as const;

export type KycStatus = (typeof KYC_STATUS)[keyof typeof KYC_STATUS];

export enum KycIdCardType {
  UNKNOWN = 0,
  PASSPORT = 1,
  PH_DRIVER_LICENSE = 10,
  PH_UMID = 11,
  PH_NATIONAL_ID = 12,
  PH_PRC_ID = 13,
  PH_POSTAL_ID = 14,
  CN_ID = 20,
  VN_ID = 30,
}

export const KycIdCardTypeLabel: Record<KycIdCardType, string> = {
  [KycIdCardType.UNKNOWN]: 'Unknown Type',
  [KycIdCardType.PASSPORT]: 'Passport',
  [KycIdCardType.PH_DRIVER_LICENSE]: "Driver's License",
  [KycIdCardType.PH_UMID]: 'Unified Multi-Purpose ID (UMID)',
  [KycIdCardType.PH_NATIONAL_ID]: 'PhilSys ID (National ID)',
  [KycIdCardType.PH_PRC_ID]: 'Professional Regulation Commission ID',
  [KycIdCardType.PH_POSTAL_ID]: 'Postal ID',
  [KycIdCardType.CN_ID]: 'Chinese Resident ID',
  [KycIdCardType.VN_ID]: 'Vietnamese Citizen ID',
};

export const KycIdTypesList = Object.keys(KycIdCardTypeLabel)
  .map((key) => Number(key))
  .filter((key) => !isNaN(key) && key !== 0)
  .map((key) => ({
    value: key,
    label: KycIdCardTypeLabel[key as KycIdCardType],
    country:
      key >= 20 && key < 30
        ? 'CN'
        : key >= 30
          ? 'VN'
          : key >= 10
            ? 'PH'
            : 'GLOBAL',
  }));

// ── Orders ──────────────────────────────────────────────────────────
// Sync with: packages/shared/src/types/order.ts
export const ORDER_STATUS = {
  PENDING_PAYMENT: 1,
  PROCESSING_PAYMENT: 2,
  PAID: 3,
  CANCELED: 4,
  REFUNDED: 5,
  WAIT_GROUP: 6,
  WAIT_DELIVERY: 7,
  SHIPPED: 8,
  COMPLETED: 9,
} as const;

export const ORDER_STATUS_LABEL: Record<number, string> = {
  [ORDER_STATUS.PENDING_PAYMENT]: 'Pending',
  [ORDER_STATUS.PROCESSING_PAYMENT]: 'Processing',
  [ORDER_STATUS.PAID]: 'Paid',
  [ORDER_STATUS.CANCELED]: 'Cancelled',
  [ORDER_STATUS.REFUNDED]: 'Refunded',
  [ORDER_STATUS.WAIT_GROUP]: 'Waiting for Group',
  [ORDER_STATUS.WAIT_DELIVERY]: 'Ready to Ship',
  [ORDER_STATUS.SHIPPED]: 'Shipped',
  [ORDER_STATUS.COMPLETED]: 'Completed',
};

// ── Banner / Ad ─────────────────────────────────────────────────────
// Sync with: packages/shared/src/types/ad.ts
export const JUMP_CATE = {
  NONE: 1,
  INTERNAL: 2,
  TREASURE: 3,
  EXTERNAL: 5,
} as const;

// ── Coupon / Marketing ──────────────────────────────────────────────
// Sync with: packages/shared/src/types/coupon.ts
export const COUPON_STATUS = {
  ACTIVE: 1,
  INACTIVE: 2,
} as const;

export const COUPON_TYPE = {
  FULL_REDUCTION: 1,
  DISCOUNT: 2,
  NO_THRESHOLD: 3,
} as const;

export const COUPON_TYPE_OPTIONS = [
  { label: 'Full reduction', value: 1 },
  { label: 'Discount', value: 2 },
  { label: 'No threshold', value: 3 },
];

export const DISCOUNT_TYPE = {
  FIXED_AMOUNT: 1,
  PERCENTAGE: 2,
} as const;

export const DISCOUNT_TYPE_OPTIONS = [
  { label: 'Fixed amount', value: 1 },
  { label: 'Percentage', value: 2 },
];

export const ISSUE_TYPE = {
  SYSTEM: 1,
  CLAIM: 2,
  REDEEM_CODE: 3,
  INVITE: 4,
} as const;

export const VALID_TYPE = {
  RANGE: 1,
  DAYS_AFTER_RECEIVE: 2,
} as const;

export const VALID_TYPE_OPTIONS = [
  { label: 'Fixed date range', value: 1 },
  { label: 'Days after receive', value: 2 },
];

// ── Finance / Wallet ────────────────────────────────────────────────
// Sync with: packages/shared/src/types/wallet.ts
export const TRANSACTION_TYPE = {
  RECHARGE: 1,
  PURCHASE: 2,
  REFUND: 3,
  REWARD: 4,
  WITHDRAW: 5,
  COIN_EXCHANGE: 6,
  INVITE_REWARD: 7,
} as const;

export const BALANCE_TYPE = {
  CASH: 1,
  COIN: 2,
} as const;

export const DIRECTION = {
  INCOME: 1,
  EXPENSE: 2,
} as const;

export const TRANSACTION_STATUS = {
  SUCCESS: 1,
  FAILED: 2,
  PROCESSING: 3,
} as const;

// Sync with: packages/shared/src/types/finance.ts
export const RECHARGE_STATUS = {
  PENDING: 1,
  PROCESSING: 2,
  SUCCESS: 3,
  FAILED: 4,
  CANCELED: 5,
} as const;

export const WITHDRAW_STATUS = {
  PENDING_AUDIT: 1,
  AUDIT_PASSED: 2,
  PROCESSING: 3,
  SUCCESS: 4,
  AUDIT_REJECTED: 5,
  FAILED: 6,
} as const;

export const WITHDRAW_METHOD = {
  GCASH: 1,
  BANK: 2,
  PAYMAYA: 3,
} as const;
