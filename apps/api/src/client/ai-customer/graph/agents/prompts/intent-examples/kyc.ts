/**
 * kyc — Intent classification example sentences (English only)
 *
 * Covers: status queries only (operation: real-time API check)
 * ~5 sentences
 *
 * Knowledge-query sentences (流程/政策/原因类) moved to rag.ts
 * because they can be answered from kyc-guide.en.md and kyc-troubleshooting.en.md
 */

export const kycExamples: string[] = [
  // ── Status queries (operation: real-time API check) ──
  'What is my KYC status?',
  'Is my KYC approved?',
  'Check my verification status',
  'Has my ID been verified?',
  'Am I KYC verified?',

  // ── Start verification (operation: initiate process) ──
  'I want to start KYC verification',
];
