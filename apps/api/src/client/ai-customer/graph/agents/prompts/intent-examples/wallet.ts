/**
 * wallet — Intent classification example sentences (English only)
 *
 * Covers: balance, withdrawals, deposits, transfers, history, KYC, failures, bonus
 * ~28 sentences (operation-only: requires API calls for real-time data)
 *
 * Knowledge-query sentences (流程/政策类) moved to rag.ts
 */

export const walletExamples: string[] = [
  // ── Balance (中文) ──
  '查余额',
  '我的余额',
  '查看余额',
  '我还有多少钱',
  '余额查询',
  '账户余额',

  // ── Balance (English) ──
  'Check my balance',
  'How much money do I have in my wallet?',
  'What is my current balance?',
  'Show me my wallet balance',
  'What is my remaining balance?',
  "What's my total balance right now?",

  // ── Withdrawals (operation only) ──
  'I want to withdraw 500 pesos',
  'Cash out my earnings',
  'Withdraw 1000 from my wallet',
  'Process a withdrawal for me',
  'Withdraw all my balance',

  // ── Deposits (operation only) ──
  'Deposit money into my account',
  'Top up my wallet',
  'I want to add funds',
  'Deposit 3000 to my wallet',

  // ── Transfers (operation only) ──
  'Transfer 200 to another user',
  'Send money to my friend',
  'Send 500 to Juan',

  // ── Transaction history ──
  'Show my transaction history',
  'What transactions did I make?',
  'View my recent activity',
  'List my recent wallet movements',

  // ── KYC status (operation: real-time check) ──
  'Is my KYC approved?',
  'Check my KYC status',
  'Has my verification been completed?',

  // ── Failures (operation: needs transaction data) ──
  'Why was my withdrawal rejected?',
  'My transaction failed, why?',
  "Why can't I withdraw my money?",
  'The withdrawal was declined',

  // ── Bonus ──
  'Do I have any bonus credits?',
  'Check my bonus balance',
  'What is my cashback amount?',
  'Show my reward points',
  'Claim my free credit',
];
