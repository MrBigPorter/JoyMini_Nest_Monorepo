/**
 * user — Intent classification example sentences (English only)
 *
 * Covers: profile, editing, addresses, password/security, phone/email, membership, settings, registration
 * ~38 sentences (operation-only: requires API calls for real-time data)
 *
 * Knowledge-query sentences (流程/政策类) moved to rag.ts
 */

export const userExamples: string[] = [
  // ── Profile viewing ──
  'View my profile',
  'Show my account information',
  'What is my username?',
  'Display my account info',

  // ── Profile editing ──
  'Edit my profile',
  'Change my display name',
  'Update my profile picture',
  'I want to update my profile',

  // ── Address management ──
  'Add a new address',
  'Change my shipping address',
  'Edit my billing address',
  'Remove my saved address',

  // ── Password / security ──
  'Change my password',
  'Reset my password',
  'I forgot my password',
  'Update my security settings',
  'Enable two-factor authentication',

  // ── Phone / email ──
  'Update my email address',
  'Change my phone number',
  'Add a new phone number',
  'Verify my email',
  "I didn't receive the verification code",

  // ── Membership (operation: real-time status) ──
  'What membership tier am I on?',
  'Check my membership status',
  'How do I upgrade my membership?',

  // ── Account settings ──
  'Change my language preference',
  'Update notification settings',
  'Set my privacy preferences',

  // ── Registration (operation: execute sign-up) ──
  'Sign up for a new account',
  'Register as a new user',
  'I want to register',
  'Can I register using Google?',
];