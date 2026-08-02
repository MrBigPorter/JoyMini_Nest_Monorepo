/**
 * coupon — Intent classification example sentences (English only)
 *
 * Covers: listing, applying codes, balance/value, promos, expiry, issues
 * ~29 sentences (operation-only: requires API calls for real-time data)
 *
 * Knowledge-query sentences (流程/政策类) moved to rag.ts
 */

export const couponExamples: string[] = [
  // ── Listing coupons ──
  'Show my available coupons',
  'What coupons do I have?',
  'List my coupons',
  'Do I have any vouchers?',
  'Show me all my discount codes',
  'What promos are available?',

  // ── Applying codes (operation only) ──
  'Apply coupon code SAVE10',
  'Use my discount code',
  'Redeem this voucher',
  'I want to use coupon WELCOME20',
  'Apply this promo code to my order',
  'Help me claim a coupon',
  'I want to claim a coupon',
  '领取优惠券',

  // ── Balance / value (operation: real-time check) ──
  'How much is my coupon worth?',
  'What is the value of this voucher?',
  'Check my coupon balance',
  'How much discount does this give?',

  // ── Promo inquiries ──
  'What promos are ongoing?',
  'Are there any current promotions?',
  'Tell me about available deals',
  'Do you have any special offers?',
  'What is the latest promo?',

  // ── Expiry (operation: real-time check) ──
  'When does my coupon expire?',
  'Is my voucher still valid?',
  'Check expiry date of my coupon',
  'My coupon expired, can I extend it?',

  // ── Issues (operation: needs user's specific coupon data) ──
  'Why is my coupon not working?',
  'Coupon code is invalid',
  'This voucher cannot be applied',
  "Why can't I use this coupon?",
  'My discount code was rejected',
];
