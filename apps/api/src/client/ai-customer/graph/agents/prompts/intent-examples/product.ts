/**
 * product — Intent classification example sentences (English only)
 *
 * Covers: search, hot items, categories, recommendations, pricing, details, stock
 * ~37 sentences (operation-only: requires API calls for real-time data)
 *
 * Knowledge-query sentences (流程/政策类) moved to rag.ts
 */

export const productExamples: string[] = [
  // ── Search ──
  'Search for shoes',
  'Find iPhone cases',
  'Look for wireless earphones',
  'I want to buy a laptop',
  'Search for products under 500',
  'Find me a blue dress',

  // ── Hot items / best sellers ──
  'What are the best sellers?',
  'Show me popular items',
  'What products are trending?',
  'What is everyone buying?',
  'Show me top rated products',

  // ── Category navigation ──
  'Show me electronics',
  'What categories do you have?',
  "Browse women's clothing",
  'List all available categories',
  'Show me items in home and living',

  // ── Recommendations ──
  'What do you recommend?',
  'Suggest products for me',
  'What similar items are there?',
  'Can you recommend a gift?',
  'Show me products like this one',

  // ── Pricing / wholesale ──
  'How much does this cost?',
  'What is the price of item 123?',
  'Do you have wholesale pricing?',
  'Is there a discount for bulk orders?',
  'What is the cheapest option?',

  // ── Product details ──
  'Tell me more about this product',
  'What are the specifications?',
  'Show product description',
  'What color options are available?',

  // ── Stock (operation: real-time availability) ──
  'Is this item in stock?',
  'Check availability for product 123',
];
