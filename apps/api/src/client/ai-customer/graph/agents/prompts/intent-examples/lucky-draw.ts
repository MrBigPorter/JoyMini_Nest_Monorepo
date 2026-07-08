/**
 * lucky-draw — Intent classification example sentences (English only)
 *
 * Covers: tickets, schedule, results, participation, prizes, rules/issues
 * ~25 sentences (operation-only: requires API calls for real-time data)
 *
 * Knowledge-query sentences (流程/规则类) moved to rag.ts
 */

export const luckyDrawExamples: string[] = [
  // ── Tickets (operation: real-time balance) ──
  'How many lucky draw tickets do I have?',
  'Check my ticket balance',
  'How do I get more tickets?',
  'Buy lucky draw tickets',
  'How many tickets do I need?',

  // ── Draw schedule (operation: real-time schedule) ──
  'When is the next lucky draw?',
  'What time is the draw?',
  'Lucky draw schedule',
  'How often is the lucky draw?',
  'Is there a draw today?',

  // ── Results / winners (operation: real-time results) ──
  'Did I win the lucky draw?',
  'Show the lucky draw results',
  'Who won the last draw?',
  'Check if I am a winner',
  'Announce the winners',

  // ── Participation (operation: join the draw) ──
  'I want to participate in the draw',

  // ── Prizes (operation: real-time prize info) ──
  'What are the prizes for the draw?',
  'What can I win in the lucky draw?',
  'Show the prize list',
  'What is the jackpot amount?',

  // ── Rules / issues (operation: needs user's ticket data) ──
  'My ticket is not showing',
];
