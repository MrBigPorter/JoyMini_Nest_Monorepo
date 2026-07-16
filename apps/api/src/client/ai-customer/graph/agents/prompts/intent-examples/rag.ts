/**
 * rag — Intent classification example sentences (English only)
 *
 * Covers: return policy, shipping, VIP, lucky draw rules, KYC FAQ, privacy, group purchase,
 *         platform FAQ, fees, payment/e-commerce terms, COD, pre-order, flash sale,
 *         withdrawal/deposit FAQ, order process FAQ, account/profile FAQ, coupon FAQ,
 *         product FAQ, lucky draw FAQ
 * ~140 sentences
 *
 * All knowledge-query sentences (流程/政策/规则类) from business Agents are consolidated here.
 * These are questions answerable from knowledge base documents alone.
 */

export const ragExamples: string[] = [
  // ── Return policy ──
  'What is the return policy?',
  'Can I return an item after 30 days?',
  'How do I return a product?',
  'What items are not returnable?',
  'Who pays for return shipping?',

  // ── Shipping ──
  'How long does shipping take?',
  'What are the shipping options?',
  'Do you offer free shipping?',
  'How much is shipping fee?',
  'Do you ship internationally?',

  // ── VIP benefits ──
  'What are the VIP benefits?',
  'How do I become a VIP?',
  'What is the VIP membership fee?',
  'Do VIP members get free shipping?',
  'VIP exclusive perks',

  // ── Lucky draw rules ──
  'How does the lucky draw work?',
  'What are the lucky draw rules?',
  'Can I join the draw multiple times?',
  'Are there age restrictions for the draw?',

  // ── KYC process FAQ ──
  'Why do I need KYC?',
  'Is KYC mandatory for withdrawal?',
  'Can I withdraw without KYC?',
  'How long does KYC approval take?',

  // ── Privacy / terms ──
  'What is your privacy policy?',
  'How do you protect my data?',
  'Read the terms of service',
  'Do you share my information?',

  // ── Group purchase ──
  'How does group buying work?',
  'Can I start a group purchase?',
  'How many people are needed for group buy?',
  'What is the discount for group purchases?',

  // ── Platform info / FAQ ──
  'What is JoyMini?',
  'How does the platform work?',
  'What payment methods do you accept?',
  'Is my information secure?',
  'How do I contact customer support?',

  // ── Fees ──
  'Are there any hidden fees?',
  'What is the transaction fee?',
  'How much is the withdrawal fee?',
  'Are there service charges?',

  // ── Payment / e-commerce term FAQ ──
  'What is COD?',
  'What does COD mean?',
  'What is Cash On Delivery?',
  'How does COD payment work?',
  'COD payment guide',
  'What is a pre-order?',
  'How does pre-order work?',
  'What is a flash sale?',
  'How does flash sale work?',
  'What is a payment gateway?',
  'What payment options are available?',
  'What is free shipping?',
  'How does free shipping work?',
  'What is a promo code?',
  'How do I use a promo code?',
  'What is a voucher?',
  'What is a discount coupon?',
  'Explain what COD is',
  'Tell me about COD payment',
  'What does pre-order mean?',

  // ── Withdrawal / Deposit FAQ (from wallet) ──
  'Can I withdraw money?',
  'How do I withdraw funds?',
  'Can I withdraw to my bank account?',
  'How do I deposit?',
  'What are the deposit methods?',
  'Can I deposit via GCash?',
  'How do I transfer funds?',
  'Can I send money to another account?',
  'Transfer from wallet to bank',
  'Where can I find my transaction records?',
  'Do I need KYC to withdraw?',

  // ── Order process FAQ (from order) ──
  'How do I request a refund?',
  'Can I get a refund for this?',
  'How long does a refund take?',
  'I received a damaged item',
  'How do I cancel an order?',

  // ── Account / Profile FAQ (from user) ──
  'How do I see my profile details?',
  'How do I change my name?',
  'How do I update my address?',
  'How do I change my password?',
  'How do I become a VIP member?',
  'How do I delete my account?',
  'How do I create an account?',

  // ── KYC detailed FAQ (from kyc — expanded) ──
  'What documents do I need for KYC?',
  'Can I use my passport for verification?',
  'What ID types are accepted?',
  "Do you accept driver's license?",
  'Can I use my UMID card?',
  'How do I complete KYC?',
  'How long does KYC verification take?',
  'What is the KYC process?',
  'How do I submit my documents?',
  'Why was my KYC rejected?',
  'My document was not accepted',
  'Why is my ID invalid?',
  'What is wrong with my submission?',
  'How do I resubmit my documents?',
  'How long has my KYC been pending?',
  'Why is my KYC taking so long?',
  'When will my verification be complete?',
  'My KYC has been pending for days',
  'How do I upgrade my KYC level?',
  'What is the highest KYC level?',
  'What are the benefits of KYC level 2?',
  'Can I increase my KYC limit?',
  'What is the withdrawal limit after KYC?',

  // ── Coupon FAQ (from coupon) ──
  'How do I use a coupon?',

  // ── Product FAQ (from product) ──
  'What is the warranty period?',
  'When will this be back in stock?',
  'Do you have this in size large?',
  'Is this available in my region?',

  // ── Lucky draw FAQ (from lucky-draw) ──
  'How do I join the lucky draw?',
  'How to join the raffle?',
  'Can I still join?',
  'Is the draw open for everyone?',
  'How do I claim my prize?',
  'Lucky draw terms and conditions',
  "Why can't I join the draw?",
  'I won but did not receive my prize',
	// ── Contact support ──
	'How to contact customer service',
	'Contact support by email',
	'What is the support email address',
	'Customer service contact information',
	'I need help from customer support',
	'How do I talk to a human agent',
	'How to reach customer support',
	'How do I contact support?',
	'How to get help',
	'Customer service phone number',

];