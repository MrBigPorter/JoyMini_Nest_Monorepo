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
  // ── 中文短查询 ──
  'kyc',
  '查看kyc',
  'KYC认证',
  '实名认证',
  '验证身份',
  'KYC状态',
  '我的认证状态',
  '身份验证',

  // ── Status queries (operation: real-time API check) ──
  'What is my KYC status?',
  'Is my KYC approved?',
  'Check my verification status',
  'Has my ID been verified?',
  'Am I KYC verified?',

  // ── Start verification (operation: initiate process) ──
  'I want to start KYC verification',

  // ── 中文补充（2026-11-19：提升中文召回） ──
  '身份认证',
  '证件审核',
  '认证申请',
  '证件照上传失败',
  '身份核验',
  '认证审核进度',
  '证件一直不通过',
  '实名信息核验',
  '认证资料提交',
  '身份认证流程',
];
