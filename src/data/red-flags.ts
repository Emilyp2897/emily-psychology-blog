import type { ConsultationWithPlanRequest, RedFlag } from './types';

// ────────────────────────────────────────────────────────────────────
// Bucket A red flags — these PAUSE plan generation entirely.
//
// When any flag here matches, the training-plan API will NOT call the
// model. The submission still routes to Emily with a clear marker at
// the top of the email so she can have a clinical conversation with
// the client before any programming begins.
//
// Note: the mental-health-crisis vocabulary is duplicated from the
// CRISIS_TERMS list in src/pages/api/chat.ts. Keeping these in sync is
// a known maintenance debt — see TODO below.
// ────────────────────────────────────────────────────────────────────

// TODO(future): extract crisis vocabulary into a shared module imported
// by both chat.ts and red-flags.ts so the two lists cannot drift apart.

const CRISIS_PATTERNS = [
  // Suicide / self-harm
  /\bsuicide\b/i,
  /kill myself/i,
  /end my life/i,
  /\bself.?harm\b/i,
  /want to die/i,
  /harm myself/i,
  /\boverdose\b/i,
  /(i am|i'm|im) in danger/i,
  // Broader mental-health-crisis indicators
  /can.?t go on/i,
  /breaking point/i,
  /at breaking point/i,
  /having a breakdown/i,
  /mental breakdown/i,
  /in crisis/i,
  /need urgent help/i,
  /i need help now/i,
  /don.?t want to be here/i,
  /no reason to live/i,
  /nothing to live for/i,
  /feel hopeless/i,
  /feel broken/i,
  /completely broken/i,
  /i can.?t cope anymore/i,
  /dire need/i,
  /\bin dire\b/i,
];

const EATING_CONCERN_PATTERNS = [
  /eating disorder/i,
  /disordered eating/i,
  /\banorexi/i,
  /\bbulim/i,
  /restrict.*food/i,
  /restricting.*food/i,
  /binge\s*eat/i,
  /undereat/i,
  /under.?eating/i,
  /purge|purging/i,
  /afraid to eat/i,
  /scared to eat/i,
  /lost.*period.*weight/i,
];

const RED_S_PATTERNS = [
  /\bred.?s\b/i,
  /amenorrh/i,
  /(missed|missing|no|not had).{0,15}period.{0,30}(month|months)/i,
  /low energy availability/i,
  /lost my period/i,
];

const ACTIVE_INJURY_PATTERNS = [
  /currently in physio/i,
  /still in rehab/i,
  /unresolved injury/i,
  /haven.?t been cleared/i,
  /waiting for surgery/i,
  /recent.{0,10}surgery/i,
  /post.?op/i,
];

function matchAny(haystack: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(haystack));
}

function buildHaystack(input: ConsultationWithPlanRequest): string {
  return [
    input.issuesWorries || '',
    input.medicalConditions || '',
    input.injuries || '',
    input.anythingElse || '',
    input.lifestyle || '',
    input.goals || '',
  ].join(' ');
}

export const RED_FLAGS: RedFlag[] = [
  {
    id: 'mental_health_crisis',
    detect: (input) => matchAny(buildHaystack(input), CRISIS_PATTERNS),
    reason:
      'Mental health crisis indicators detected. No plan should be generated. Emily must reach out directly with crisis resources.',
    clientMessage: [
      "Thank you for sharing what's going on for you.",
      '',
      "What you've described matters, and it's the kind of thing that needs a real person, not an automated plan.",
      '',
      'If you are in immediate danger, please contact emergency services straight away. 999 in the UK, 112 in Ireland.',
      '',
      'For 24/7 emotional support: Samaritans on 116 123 (UK and Ireland). In Ireland, Pieta on 1800 247 247 is there for suicide and self-harm crisis support.',
      '',
      'You can find more support contacts on our resources page (/resources).',
      '',
      'Emily has been notified about your message and will be in touch personally. You can also email her directly at emilyphelan@mindthegael.co.uk.',
    ].join('\n'),
  },
  {
    id: 'eating_concerns',
    detect: (input) => matchAny(buildHaystack(input), EATING_CONCERN_PATTERNS),
    reason:
      'Possible eating concern or disordered eating language detected. Training programming should not begin without clinical input.',
    clientMessage: [
      'Thank you for being so honest in your form.',
      '',
      "From what you've shared, your situation is one Emily wants to talk through with you directly before any training programme is put together. She'll be in touch within 48 hours.",
      '',
      'In the meantime, you can email her directly at emilyphelan@mindthegael.co.uk, or visit our resources page (/resources) for professional support contacts.',
    ].join('\n'),
  },
  {
    id: 'red_s_or_amenorrhea',
    detect: (input) => matchAny(buildHaystack(input), RED_S_PATTERNS),
    reason:
      'RED-S or amenorrhea indicators detected. Clinical conversation required before programming begins.',
    clientMessage: [
      'Thank you for sharing all of this.',
      '',
      "What you've described needs a clinical conversation before we build a training plan together. Emily will be in touch within 48 hours so you can talk it through properly.",
      '',
      'In the meantime, you can email her directly at emilyphelan@mindthegael.co.uk.',
    ].join('\n'),
  },
  {
    id: 'active_unresolved_injury',
    detect: (input) => matchAny(buildHaystack(input), ACTIVE_INJURY_PATTERNS),
    reason:
      'Active, unresolved injury or post-surgical rehab in progress. Programming requires coordination with the client\'s treating clinician.',
    clientMessage: [
      'Thanks for letting us know about your injury.',
      '',
      "Because you're still in active rehab, Emily wants to coordinate with you (and your physio, if relevant) before building a training plan. She'll be in touch within 48 hours.",
      '',
      'You can also reach her directly at emilyphelan@mindthegael.co.uk. If you have a return-to-play target in mind, mention it in your reply.',
    ].join('\n'),
  },
];

export function detectRedFlags(input: ConsultationWithPlanRequest): RedFlag[] {
  return RED_FLAGS.filter((flag) => flag.detect(input));
}
