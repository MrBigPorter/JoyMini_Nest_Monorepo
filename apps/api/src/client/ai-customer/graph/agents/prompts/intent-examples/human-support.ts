/**
 * human-support — Intent classification example sentences (English only)
 *
 * Covers: transfer to human agent, complaints, dissatisfaction, complex issues
 * ~30 sentences
 *
 * When matched, orchestrator triggers transferToHuman immediately.
 */

export const humanSupportExamples: string[] = [
  // ── Transfer requests ──
  'Transfer me to a human agent',
  'I want to speak to a real person',
  'Can I talk to a human?',
  'Connect me with customer service',
  'I need a human representative',
  'Please transfer me to a live agent',
  'Get me a human please',
  'I want a real customer service agent',
  'Can a person help me instead?',
  'I need to speak with someone real',

  // ── Complaints ──
  'I want to make a complaint',
  'I need to file a complaint',
  'This is unacceptable, I want to complain',
  'I am very dissatisfied with the service',
  'I want to speak to a manager',
  'This is a terrible experience',
  'I demand to speak to someone in charge',

  // ── Complex issues ──
  'This issue is too complicated for chat',
  'I need human assistance for this problem',
  'My problem needs special handling',
  'This requires manual review',
  'I need help that a bot cannot provide',

  // ── Escalation ──
  'Escalate this to a supervisor',
  'I need this to be escalated',
  'Please escalate my issue',
  'Can you escalate this for me?',
  'I need to escalate this matter',

  // ── Urgent issues ──
  'This is urgent, I need a person',
  'I have an emergency situation',
  'This is time-sensitive, connect me to a human',
];
