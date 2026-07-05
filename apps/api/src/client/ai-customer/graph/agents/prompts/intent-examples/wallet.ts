/**
 * wallet — Intent classification example sentences
 *
 * Covers: balance queries, withdrawals, deposits, transfers,
 * transaction history, KYC status queries, and failure reasons.
 *
 * NOTE: KYC status queries are included (the wallet agent can
 * check KYC status). KYC document submission is NOT included —
 * those would be a separate domain in the future.
 */
export const walletExamples: string[] = [
  // Balance queries
  'Check my balance',
  'How much money do I have in my wallet?',
  'What is my current balance?',

  // Withdrawals
  'I want to withdraw 500 pesos',
  'Cash out my earnings',
  'Can I withdraw money?',

  // Deposits
  'Deposit money into my account',
  'Top up my wallet',

  // Transfers
  'Transfer 200 to another user',

  // Transaction history
  'Show my transaction history',

  // KYC status (read-only, not submission)
  'Is my KYC approved?',
  'Check my KYC status',

  // Conditional / failure queries
  'Why was my withdrawal rejected?',
  'Can I withdraw without KYC?',
];
