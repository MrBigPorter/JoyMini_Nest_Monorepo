/**
 * order — Intent classification example sentences (English only)
 *
 * Covers: listing, tracking/delivery, cancellation, returns/refunds, payment status, details
 * ~33 sentences (operation-only: requires API calls for real-time data)
 *
 * Knowledge-query sentences (流程/政策类) moved to rag.ts
 */

export const orderExamples: string[] = [
  // ── Order listing (中文) ──
  '查看我的订单',
  '我的订单',
  '查看订单',
  '订单列表',
  '最近订单',
  '显示我的所有订单',

  // ── Order listing (English) ──
  'Show my orders',
  'List all my orders',
  'What are my recent orders?',
  'View my order history',
  'I want to see my orders',
  'Show me orders from last month',

  // ── Tracking / delivery ──
  'Where is my order?',
  'Track my order',
  'What is the status of my order?',
  'When will my order arrive?',
  'Is my order on the way?',
  'Tracking number for my order',
  'Why is my delivery delayed?',
  'What is the estimated delivery date?',

  // ── Cancellation (operation only) ──
  'Cancel my order',
  'I want to cancel order 12345',
  'Can I still cancel?',
  'Cancel my order please',
  'My order was cancelled, why?',

  // ── Returns / refunds (operation only) ──
  'I want to return this item',
  'Return my order',

  // ── Payment status ──
  'Has my payment been processed?',
  'Check payment status for order 12345',
  'Did my payment go through?',
  'Why is my payment pending?',
  'When will my payment be confirmed?',

  // ── Order details ──
  'Show details for order 12345',
  'What items are in my order?',
  'How much was my order total?',
  'What is my order number?',
  'I want to change my shipping address',
  'Can I modify my order?',
];
