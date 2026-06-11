import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';
import Stripe from 'stripe';
import { sql } from '../../lib/db';
import type { ConsultationWithPlanRequest, ProgramTrackId, SportProfile, Exercise } from '../../data/types';
import { findSportProfile } from '../../data/sport-profiles';
import {
  filterExercises,
  expandEquipmentTags,
  normaliseLevel,
  detectAvoidIfTags,
} from '../../data/exercises';
import { getTrackProtocol, getTrackCitations } from '../../data/program-tracks';
import { EMILY_CALENDAR_BOOKING_URL } from '../../consts';
import { buildClientPlanEmailHtml, buildEmilyNotificationEmailHtml, stripDashes, buildSignatureText } from '../../lib/email-format';

// Summarise the player's existing sport load. Mirrors the helper in
// programme-intake.ts. Critical for the physical plan: total weekly
// sessions = club trainings + matches + plan sessions, and the plan must
// not push that past recoverable load.
function describeSportLoad(trainings: string | undefined, matches: string | undefined): string {
  const t = (trainings || '').trim();
  const m = (matches || '').trim();
  if (!t && !m) return 'not provided';
  const parts: string[] = [];
  if (t) {
    if (t === '0') parts.push('no club trainings');
    else if (t === '4+') parts.push('4 or more club trainings per week');
    else parts.push(`${t} club training${t === '1' ? '' : 's'} per week`);
  }
  if (m) {
    if (m === '0') parts.push('no matches');
    else if (m === 'variable') parts.push('variable matches (championship blocks etc.)');
    else parts.push(`${m} match${m === '1' ? '' : 'es'} per week`);
  }
  return parts.join(' + ');
}

// Map seasonPhase enum to a description for the model. Mirrors the helper in
// programme-intake.ts so the teaser and the full plan agree on what each
// phase means.
function describeSeasonPhase(phase: string | undefined | null): string {
  switch (phase) {
    case 'pre_season':
      return 'Pre-season: building a base before the season starts (general capacity, accumulation, habit-setting).';
    case 'championship_leadup':
      return 'Championship lead-up: peaking and tapering for matches (intensification, then volume drop into match-readiness).';
    case 'in_season':
      return 'In-season: maintenance during competition (lower volume, top-up work, recovery prioritised).';
    case 'off_season':
      return 'Off-season: rest, recovery, lighter work, deeper mental skill development.';
    default:
      return 'not provided. Treat as a general plan with no specific phase emphasis.';
  }
}

export const prerender = false;

const EMILY_EMAIL = 'emilyphelan@mindthegael.co.uk';

// POST /api/programme-finalize
// Body: { token: string; sessionId: string }
//
// Called from /programme-success after the user completes Stripe checkout.
// Verifies the Stripe session is paid, fetches the original intake from the
// database, generates the FULL plan, emails it to the client and Emily, and
// marks the intake session as finalized.

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const token = typeof body?.token === 'string' ? body.token : '';
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';

    if (!token || !sessionId) {
      return json({ error: 'Missing token or sessionId.' }, 400);
    }

    const result = await finalizeIntake({ token, sessionId });
    if (!result.ok) {
      return json({ error: result.error }, result.status);
    }
    return json({ success: true, message: result.message });
  } catch (error: any) {
    console.error('Programme finalize error:', error);
    return json({ error: getErrorMessage(error) }, 500);
  }
};

// Core finalize logic, extracted so both the success-page POST handler and
// the Stripe webhook can call it. Looks up the intake, verifies Stripe
// payment, generates the full plan, routes the emails (Emily vs client
// based on PLAN_DESTINATION_STANDARD), and marks the intake finalized.
// Idempotent: a second call after the intake is already finalized returns
// ok=true with a short "already done" message so the webhook can safely
// retry without double-generating.
export type FinalizeResult =
  | { ok: true; alreadyFinalized?: boolean; sentFullPlanToClient?: boolean; message: string }
  | { ok: false; status: number; error: string };

export async function finalizeIntake(opts: {
  token: string;
  sessionId: string;
}): Promise<FinalizeResult> {
  const { token, sessionId } = opts;

  // 1. Fetch the intake session from the database.
  const intakeResult = await sql<{
    intake_data: ConsultationWithPlanRequest;
    programme_track: ProgramTrackId | null;
    finalized_at: string | null;
    red_flag_id: string | null;
    plan_type: 'physical' | 'mental' | null;
  }>`
    SELECT intake_data, programme_track, finalized_at, red_flag_id, plan_type
    FROM intake_sessions
    WHERE id = ${token}::uuid
    LIMIT 1
  `;

  const row = intakeResult.rows[0];
  if (!row) {
    return { ok: false, status: 404, error: 'Intake session not found.' };
  }
  if (row.red_flag_id) {
    return { ok: false, status: 403, error: 'This intake was flagged for direct review by Emily. Plan generation is blocked.' };
  }
  if (row.finalized_at) {
    // Already done. Idempotent success so the webhook can retry safely.
    return { ok: true, alreadyFinalized: true, message: 'Plan already finalized.' };
  }

  // 2. Verify the Stripe session is paid.
  const stripeSecretKey = import.meta.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    throw new Error('Missing STRIPE_SECRET_KEY.');
  }
  const stripe = new Stripe(stripeSecretKey);
  const stripeSession = await stripe.checkout.sessions.retrieve(sessionId);

  if (stripeSession.payment_status !== 'paid') {
    return {
      ok: false,
      status: 402,
      error: `Stripe session payment status is "${stripeSession.payment_status}". Plan will only be generated once payment is confirmed.`,
    };
  }

  // 3. Generate the FULL plan. Branch on plan type.
  const intake = row.intake_data;
  const planType = row.plan_type || 'physical';
  const track = (row.programme_track || 'standard') as ProgramTrackId;
  const sportProfile = findSportProfile(intake.sport || '');

  let fullPlan: string;
  if (planType === 'mental') {
    fullPlan = await generateMentalFullPlan({ intake });
  } else {
    const level = normaliseLevel(intake.exerciseLevel);
    const equipmentTags = expandEquipmentTags(intake.equipment);
    const avoidIfTags = detectAvoidIfTags({
      injuries: intake.injuries,
      medicalConditions: intake.medicalConditions,
      issuesWorries: intake.issuesWorries,
      cycleStatus: intake.cycleStatus,
      programTrack: intake.programTrack,
    });
    const exercisePool = filterExercises({
      equipment: equipmentTags,
      level,
      avoidIfTags,
    });
    fullPlan = await generateFullPlan({
      intake,
      track,
      sportProfile,
      exercisePool,
      avoidIfTags,
    });
  }

  // 4. Decide where the plan goes.
  const standardDestination = readStandardDestination();
  const isSpecialisedPhysicalTrack = planType === 'physical' && track !== 'standard';
  const sendFullPlanToClient = standardDestination === 'client' && !isSpecialisedPhysicalTrack;

  // 5. Email Emily a notification copy (always).
  await sendEmilyNotification({
    intake,
    fullPlan,
    sportProfile,
    track,
    sessionId,
    token,
    planType,
    reviewRequired: !sendFullPlanToClient,
  });

  // 6. Email the client.
  if (sendFullPlanToClient) {
    await sendClientPlanEmail({ intake, fullPlan, sportProfile });
  } else {
    await sendClientHoldingEmail({ intake, planType });
  }

  // 7. Mark intake session finalized.
  await sql`
    UPDATE intake_sessions
    SET finalized_at = NOW(), stripe_session_id = ${sessionId}
    WHERE id = ${token}::uuid
  `;

  return {
    ok: true,
    sentFullPlanToClient: sendFullPlanToClient,
    message: sendFullPlanToClient
      ? 'Your plan has been generated and emailed to you. Check your inbox.'
      : 'Thanks for your purchase. Emily is reviewing your plan and will email it to you within 48 hours.',
  };
}

// ─── Plan generation ────────────────────────────────────────────────

async function generateFullPlan(input: {
  intake: ConsultationWithPlanRequest;
  track: ProgramTrackId;
  sportProfile: SportProfile;
  exercisePool: Exercise[];
  avoidIfTags: string[];
}): Promise<string> {
  const apiKey = import.meta.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Missing ANTHROPIC_API_KEY environment variable.');
  }

  const model =
    import.meta.env.ANTHROPIC_MODEL_PLAN ||
    import.meta.env.ANTHROPIC_MODEL ||
    'claude-sonnet-4-5';

  const client = new Anthropic({ apiKey });

  // Token budget scales with plan duration. The new format (tables + a
  // blockquote describing each exercise + coach notes per week) needs
  // ~800-1200 tokens per week. Headroom factored in to avoid mid-week
  // cutoffs. Specialised tracks include the extra protocol block so they
  // get a bit more.
  const is12Week = (input.intake.planDuration || '').includes('12');
  const baseTokens = is12Week ? 12000 : 6000;
  const trackBonus = input.track !== 'standard' ? 1500 : 0;
  const maxTokens = baseTokens + trackBonus;

  const response = await client.messages.create({
    model,
    temperature: 0.5,
    max_tokens: maxTokens,
    // Cache the full-plan system prompt. This is the longest prompt in
    // the codebase (~1500 tokens with the beginner-accessibility rule,
    // output structure spec, etc.) and the biggest cache-savings target.
    system: [
      { type: 'text', text: buildSystemPrompt(), cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: buildPlanPrompt(input) }],
  });

  const raw = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  // Strip em-dashes the model may have emitted despite the prompt rule.
  return stripDashes(raw);
}

// ─── Mental performance plan generation ─────────────────────────────

async function generateMentalFullPlan(input: {
  intake: ConsultationWithPlanRequest;
}): Promise<string> {
  const apiKey = import.meta.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Missing ANTHROPIC_API_KEY environment variable.');
  }

  const model =
    import.meta.env.ANTHROPIC_MODEL_PLAN ||
    import.meta.env.ANTHROPIC_MODEL ||
    'claude-sonnet-4-5';

  const client = new Anthropic({ apiKey });

  const is12Week = (input.intake.planDuration || '').includes('12');
  const maxTokens = is12Week ? 12000 : 6000;

  const response = await client.messages.create({
    model,
    temperature: 0.5,
    max_tokens: maxTokens,
    system: [
      { type: 'text', text: buildMentalSystemPrompt(), cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: buildMentalPlanPrompt(input) }],
  });

  const raw = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  return stripDashes(raw);
}

function buildMentalSystemPrompt(): string {
  return [
    'You are the mental performance planning assistant for Mind the Gael, an online platform run by Emily Phelan that focuses on women\'s health and performance for female athletes.',
    '',
    'You are generating the FULL mental performance plan for a client who has just paid. This plan goes directly to the client. There is no human review step. Make it complete, accurate, clear, and practical.',
    '',
    'You are NOT a clinician. You do NOT diagnose. You DO note any limitations and route the athlete to qualified support where appropriate.',
    '',
    'KNOWLEDGE BASE. Build your plan on the 12 themes of the Gael Performance Toolkit, used by Mind the Gael across the 12-month editorial calendar:',
    '1. Pressure and performance anxiety (choking under pressure, pre-game nerves, breath control, reframing arousal).',
    '2. Attention and focus (attention control theory, narrow vs broad focus, refocusing routines after errors).',
    '3. Confidence (self-efficacy sources, evidence logs, recovering confidence after setbacks).',
    '4. Identity and pressure (multiple selves, athlete identity as one part of you, deidentification under high stakes).',
    '5. Motivation (intrinsic vs extrinsic, autonomous motivation, values-based goal setting, self-determination theory).',
    '6. Pre-performance routines (anchoring, ritual vs superstition, building a routine that scales to pressure).',
    '7. Self-talk (instructional vs motivational, switching internal voice under fatigue, second-person framing).',
    '8. Recovery from mistakes (the next-play mindset, behavioural reset cues, error tolerance).',
    '9. Visualisation and imagery (PETTLEP model, internal vs external imagery, layering somatic detail).',
    '10. Team and social pressure (social identity, group dynamics, communicating under load).',
    '11. Injury and return-to-play psychology (identity disruption, kinesiophobia, staged psychological return).',
    '12. Long-term mental skill development (off-season skill consolidation, lifelong athlete identity, transition planning).',
    '',
    'CITATION RULE:',
    'Any specific claim, statistic, or technique you offer that is NOT obvious general sport psychology knowledge must come from a real named source: a peer-reviewed paper (author plus year, e.g. Eysenck et al. 2007 on Attention Control Theory; Hatzigeorgiadis et al. 2011 on self-talk; Bandura 1997 on self-efficacy), a recognised authority (BPS, NHS, BASES, AASP), or a widely-cited framework (PETTLEP, Self-Determination Theory, Reinvestment Theory). If you cannot name a real source you are confident exists, do NOT make the specific claim. Frame it as general principle. Never invent citations, statistics, study findings, author names, or journal names.',
    '',
    'CRISIS RULE:',
    'If the intake responses indicate the client is in mental health crisis (panic, self-harm, severe distress), do NOT proceed with a plan. Output a short message directing them to emergency support (Samaritans 116 123 in UK/IE, Pieta House 1800 247 247 in IE) and tell them Emily will be in touch directly.',
    '',
    'OUTPUT STRUCTURE. Use exactly these section headers, in this order:',
    '',
    '# ATHLETE SNAPSHOT',
    '(2-3 lines summarising who they are, their sport, competitive level, and the headline mental performance areas they want to work on.)',
    '',
    '# PLAN OVERVIEW',
    '(Goals for the plan, the weekly themes they will move through, and the through-line: what state you are trying to help them move toward by the end.)',
    '',
    '# WEEK-BY-WEEK PLAN',
    'For each week use this exact structure:',
    '',
    '  ## Week N: [theme name, drawn from the 12 toolkit themes where relevant]',
    '  **Focus:** one short line on what this week is doing for them.',
    '',
    '  **Concept of the week**',
    '  (3-5 lines explaining the concept in plain English. Name the framework or author where relevant, e.g. "Attention Control Theory (Eysenck et al. 2007) says that under pressure, attention narrows toward threat cues. The fix is not to try harder, it is to pre-train a refocus trigger.")',
    '',
    '  **Daily practice (5-10 minutes)**',
    '  A short markdown table listing what they do each day this week. Format:',
    '  | Day | Practice | What it builds |',
    '  | --- | --- | --- |',
    '  | Mon | 4-7-8 breath cycle, 3 rounds before bed | Down-regulation under load |',
    '  | Tue | Write three confidence anchors in your phone notes | Self-efficacy evidence base |',
    '',
    '  **Performance moment to apply it**',
    '  One short paragraph: where in their training or competition week they should consciously apply the concept. Make this concrete to the sport and competitive level they gave you.',
    '',
    '  **Reflection prompt**',
    '  One question they answer at the end of the week, three lines max in their notes.',
    '',
    '# ROUTINES TO BUILD',
    '(A short section assembling the pre-performance routine, refocus routine, and post-mistake reset cue the client has built up by the end of the plan. Make these specific to the client, not generic.)',
    '',
    '# COACH NOTES (FOR THE CLIENT)',
    '(For each week, 2-3 lines:',
    '  ## Week N',
    '  Why this week comes here:',
    '  What to watch for in yourself:',
    '  Adjust if: )',
    '',
    '# THINGS TO TRACK',
    '(A short list of what the athlete should journal or notice during the plan: confidence level pre and post training, refocus speed after errors, sleep quality before competition, etc.)',
    '',
    'VOICE:',
    '- Warm, direct, grounded. Plain English. Match Emily\'s voice: no hype, no motivational filler, no emojis.',
    '- Second person ("You will...", "Your goal this week...").',
    '- Avoid em-dashes and en-dashes (use periods, commas, or parentheses instead).',
    '- Concrete cues, not abstract directives. If you mention a technique, give the actual steps.',
    '- The plan goes to a real athlete, not a textbook reader. Practical over academic.',
  ].join('\n');
}

function buildMentalPlanPrompt(input: {
  intake: ConsultationWithPlanRequest;
}): string {
  const { intake } = input;

  const clientBlock = [
    'CLIENT INPUT:',
    `- Name: ${intake.name}`,
    `- Sport: ${intake.sport || 'not provided'}`,
    `- Competition level: ${intake.competitionLevel || 'not provided'}`,
    `- Years competing: ${intake.yearsCompeting || 'not provided'}`,
    `- Plan duration: ${intake.planDuration || '6 weeks'}`,
    `- Season phase: ${describeSeasonPhase(intake.seasonPhase)}`,
    `- Existing weekly sport load: ${describeSportLoad(intake.clubTrainingsPerWeek, intake.matchesPerWeek)}`,
    `- Performance moments they want to work on: ${(intake.performanceMomentsToWorkOn || []).join(', ') || 'not provided'}`,
    `- Current mental performance routines: ${intake.currentRoutines || 'not provided'}`,
    `- Past peak moment: ${intake.peakMoment || 'not provided'}`,
    `- Past struggle moment: ${intake.struggleMoment || 'not provided'}`,
    `- Current confidence level (1-10): ${intake.confidenceLevel || 'not provided'}`,
    `- Companion physical training plan the client is also doing: ${intake.companionPlanSummary || 'not provided. Build this plan as a standalone.'}`,
    `- Their goals narrative: ${intake.goals}`,
    `- Anything else they shared: ${intake.anythingElse || 'not provided'}`,
  ].join('\n');

  const seasonPhaseInstruction = intake.seasonPhase
    ? '\nShape the week-by-week progression to fit the season phase. Pre-season: front-load foundation routines (breathing, anchors, pre-performance routines) and habit-setting; later weeks layer self-talk and mistake reset. Championship lead-up: front-load composure under pressure, sharpening focus, and mistake reset; later weeks rehearse the full championship-week routine. In-season: prioritise quick-reset tools, self-talk for fatigue, and managing pressure between fixtures. Off-season: deeper identity work, reflection, and longer-term mental skill development.'
    : '';

  const sportLoadInstruction = (intake.clubTrainingsPerWeek || intake.matchesPerWeek)
    ? '\nAnchor weekly routines to moments the player actually has in her week. If matches > 0: prioritise pre-match routines, post-mistake reset for mid-game, post-match decompression. The "performance moment to apply it" should reference real sessions (training days, match day, warm-up, cool-down). If matches = 0 right now (pre-season or off-season): anchor routines to training days, in-session focus, and mental-skill homework between sessions. Do not invent matches the player has not described.'
    : '';

  const companionInstruction = intake.companionPlanSummary
    ? '\nThe client is also doing a Mind the Gael Physical Training Plan. Where it fits, anchor "Performance moment to apply it" each week to a real session or moment from their training plan (e.g. the heaviest lift day, conditioning blocks, sport-specific work). In Routines to Build, suggest applying pre-performance routines to those specific sessions. Stay within what they actually described, never invent specifics about the physical plan.'
    : '';

  return [
    `Create a ${intake.planDuration || '6-week'} mental performance plan for the following female athlete client. This plan will be emailed directly to them.`,
    '',
    clientBlock,
    seasonPhaseInstruction,
    sportLoadInstruction,
    companionInstruction,
    '',
    'Follow the system prompt rules strictly. Use the exact output section headers it specifies. Anchor every week\'s concept to the 12 themes of the Gael Performance Toolkit, choosing the themes that best match the performance moments and struggles the client described.',
  ].join('\n');
}

function buildSystemPrompt(): string {
  return [
    'You are the strength and conditioning planning assistant for Mind the Gael, an online platform run by Emily Phelan that focuses on women\'s health and performance for female athletes.',
    '',
    'You are generating the FULL training plan for a client who has just paid for a programme. This plan goes directly to the client. There is no human review step. Make it complete, accurate, and clear.',
    '',
    'You are NOT a clinician. You do NOT diagnose. You DO note any limitations.',
    '',
    'PROGRAMMING PRINCIPLES YOU MUST FOLLOW:',
    '1. Progressive overload across the plan duration. Include at least one deload week in any plan of 4+ weeks.',
    '2. Match training to the client\'s stated experience level.',
    '   Beginners (less than 1 year): cap at 3 strength sessions/week; bodyweight plus light external load for the first 2 weeks; RPE 6-7 ceiling for the first 2 weeks.',
    '   Intermediates (1-3 years): up to 4 sessions/week; RPE 7-8.',
    '   Advanced (3+ years): up to 5 sessions/week; RPE 8-9 with explicit monitoring cues.',
    '3. NEVER prescribe an exercise that requires equipment the client did not list. You will be given an AVAILABLE EXERCISE POOL. Choose only from it.',
    '4. Use the SPORT PROFILE provided to shape conditioning, power work, and injury-prevention focus.',
    '5. Cycle awareness: assume a typical 28-day cycle unless the client states otherwise. Where relevant, suggest where heavier strength work and higher-intensity conditioning fit best (typically follicular phase) and where deload, mobility, and aerobic work fit best (typically late luteal). Phrase as GUIDANCE, not prescription.',
    '6. Contraindications: read the injuries and medical fields carefully. The AVAILABLE EXERCISE POOL has already been filtered to remove exercises contraindicated by the client\'s stated history.',
    '',
    'BEGINNER ACCESSIBILITY RULE:',
    'If the client\'s experience level is "Beginner" or contains "less than 1 year", you MUST explain every S&C term in plain English the first time it appears in client-facing content. In particular:',
    '- RPE: "Rate of Perceived Exertion. A scale from 1 to 10 of how hard the effort feels. RPE 6 means you have 4 reps left in the tank. RPE 9 means you have 1 rep left."',
    '- Sets and reps: "A rep is one complete movement (one squat). A set is a group of reps done back-to-back (e.g. 1 set of 8 reps = 8 squats in a row)."',
    '- Deload: "A planned lighter week. The point is recovery, not progress. You will still train, just with less weight or fewer sets."',
    '- Progressive overload: "Gradually doing a bit more over time, e.g. one more rep, slightly more weight, or one more set."',
    '- Tempo (if used): explain the 4-digit notation (e.g. 3-0-1-0 = 3 seconds down, 0 hold at bottom, 1 second up, 0 pause at top).',
    '- Any other technical term gets a short plain-English explanation the first time it appears.',
    'For intermediate and advanced clients, assume familiarity with these terms.',
    'Write all client-facing sections in second person ("You will...", "Your goal this week..."). Use concrete cues, not abstract directives. Avoid jargon for jargon\'s sake.',
    '',
    'CITATION RULE:',
    'Any specific claim, statistic, or technique you offer that is NOT obvious general programming knowledge must come from a real named source: a peer-reviewed paper (author plus year), a recognised authority (NICE, POGP, Aspetar, NHS, WHO, ACOG, ESHRE), or a widely-cited framework. If you cannot name a real source you are confident exists, do NOT make the specific claim. Frame it as general principle instead. Never invent citations, statistics, study findings, author names, or journal names.',
    '',
    'OUTPUT STRUCTURE. Use exactly these section headers, in this order:',
    '',
    '# CLIENT SNAPSHOT',
    '(2-3 lines summarising who they are, where they\'re starting, the key constraints.)',
    '',
    '# PLAN OVERVIEW',
    '(Goals, weekly structure at a glance, planned deload week(s), expected progression arc.)',
    '',
    '# WEEK-BY-WEEK PLAN',
    'For each week, use this exact structure:',
    '',
    '  ## Week N: [theme]',
    '  **Focus:** one short line on the week\'s focus.',
    '',
    '  ### Session 1: [day type, e.g. Lower body strength]',
    '  | Exercise | Sets | Reps | RPE | Rest |',
    '  | --- | --- | --- | --- | --- |',
    '  | Goblet squat | 3 | 8 | 7 | 90s |',
    '  | Dumbbell RDL | 3 | 10 | 7 | 60s |',
    '',
    '  Immediately after the table, add a markdown blockquote describing each exercise in one short plain-English line. Format:',
    '  > **Goblet squat:** stand tall holding a dumbbell at chest height, sit your hips back and down like sitting into a chair, drive through your feet to stand. Knees track over toes.',
    '  > **Dumbbell RDL:** hold dumbbells in front of your thighs, hinge at the hips while keeping a soft bend in your knees, lower the weights down your shins, squeeze your glutes to stand.',
    '',
    '  For beginners, ALWAYS include an exercise description. For intermediate/advanced you can omit descriptions for very common exercises (squat, deadlift, pull-up) but always describe less common ones.',
    '',
    '  **Cues:** one short line of session-level coaching cues.',
    '',
    '  ### Session 2: [day type]',
    '  (same table format)',
    '',
    '  **Cycle consideration:** one short line.',
    '  **How to know you are ready to progress:** one short line.',
    '',
    'EVERY session block MUST contain a markdown table with the columns: Exercise, Sets, Reps, RPE, Rest. Do not list exercises as bullet points. Do not omit the separator row (| --- | --- | --- | --- | --- |).',
    '',
    '# COACH NOTES',
    '(For each week, 2-4 lines:',
    '  ## Week N',
    '  Progression rationale:',
    '  What to watch for:',
    '  Adjust if: )',
    '',
    '# CONTRAINDICATED EXERCISES AND SUBSTITUTES',
    '(Based on the client\'s injuries and medical input, list what you excluded and what you substituted in.)',
    '',
    '# THINGS TO TRACK',
    '(Things the athlete should track or report back on during the programme. Replace the v1 "open questions for Emily" pattern; this version of the plan goes direct to the client.)',
    '',
    'VOICE:',
    '- WEEK-BY-WEEK and CLIENT-FACING sections: warm, direct, plain English, encouraging without hype. Match Emily\'s tone: grounded, practical. No motivational filler. No emojis. Avoid em-dashes and en-dashes (use periods, commas, or parentheses instead).',
    '- COACH NOTES sections: technical, concise, useful to a coach.',
  ].join('\n');
}

function buildPlanPrompt(input: {
  intake: ConsultationWithPlanRequest;
  track: ProgramTrackId;
  sportProfile: SportProfile;
  exercisePool: Exercise[];
  avoidIfTags: string[];
}): string {
  const { intake, track, sportProfile, exercisePool, avoidIfTags } = input;
  const trackProtocol = getTrackProtocol(track);
  const trackCitations = getTrackCitations(track);

  const sportProfileBlock = [
    `SPORT PROFILE. Use this to shape sport-specific conditioning, power work, and injury-prevention focus:`,
    `Sport: ${sportProfile.name}`,
    `Energy system: ${sportProfile.energy_system}`,
    `Primary demands: ${sportProfile.primary_demands.join(', ')}`,
    `Power emphasis: ${sportProfile.power_emphasis}`,
    `Contact load: ${sportProfile.contact_load}`,
    `Common injury hotspots: ${sportProfile.injury_hotspots.join(', ')}`,
    `Programming notes: ${sportProfile.programming_notes}`,
  ].join('\n');

  const exercisePoolBlock = [
    `AVAILABLE EXERCISE POOL. You MUST choose only from this filtered list (already screened for equipment, level, and contraindications):`,
    ...exercisePool.map(
      (ex) =>
        `- ${ex.name} [${ex.category}; equipment: ${ex.equipment.join('/')}]${ex.notes ? '. Notes: ' + ex.notes : ''}`
    ),
  ].join('\n');

  const trackBlock = trackProtocol
    ? [
        '--- SPECIALISED TRACK PROTOCOL ---',
        trackProtocol,
        '',
        'CITATIONS for this track (these are real, established sources you may reference by name):',
        ...trackCitations.map((c) => `- ${c}`),
      ].join('\n')
    : 'Track: standard (no specialised protocol applies).';

  const avoidBlock = avoidIfTags.length
    ? `DETECTED CONTRAINDICATION TAGS (already filtered out of the exercise pool): ${avoidIfTags.join(', ')}`
    : 'No specific contraindication tags detected from the input.';

  const clientBlock = [
    'CLIENT INPUT:',
    `- Age: ${intake.age}`,
    `- Height: ${intake.height || 'not provided'}`,
    `- Weight: ${intake.weight || 'not provided'}`,
    `- Experience level: ${intake.exerciseLevel || 'not provided'}`,
    `- Sports background: ${intake.sportsOrNot || 'not provided'}`,
    `- Equipment available: ${(intake.equipment || []).join(', ') || 'not provided'}`,
    `- Current activity level: ${intake.currentActivityLevel || 'not provided'}`,
    `- Sessions per week the schedule allows: ${intake.frequencyPerWeek ?? 'not provided'}`,
    `- Plan duration: ${intake.planDuration || '6 weeks'}`,
    `- Season phase: ${describeSeasonPhase(intake.seasonPhase)}`,
    `- Existing weekly sport load: ${describeSportLoad(intake.clubTrainingsPerWeek, intake.matchesPerWeek)}`,
    `- Plan goals: ${(intake.planGoals || []).join(', ')}`,
    `- Issues/concerns: ${intake.issuesWorries || 'none provided'}`,
    `- Lifestyle: ${intake.lifestyle || 'not provided'}`,
    `- Medical conditions: ${intake.medicalConditions || 'none'}`,
    `- Injuries / limitations: ${intake.injuries || 'none'}`,
    `- Cycle status: ${intake.cycleStatus || 'not provided'}`,
    `- Current week looks like: ${intake.currentWeek || 'not provided'}`,
    `- Companion mental performance plan the client is also doing: ${intake.companionPlanSummary || 'not provided. Build this plan as a standalone.'}`,
    `- Anything else: ${intake.anythingElse || 'not provided'}`,
    `- Specific goals narrative: ${intake.goals}`,
  ].join('\n');

  const seasonPhaseInstruction = intake.seasonPhase
    ? '\nShape the programme structure to match the season phase. Pre-season: accumulation block (general strength, capacity, movement quality), progressive volume, no peaking. Championship lead-up: intensification through the first weeks, then taper into match-readiness across the final 1-2 weeks (volume drops, intensity stays). In-season: maintenance week structure (lower volume, top-up work, recovery sessions, lifts kept brief and frequent). Off-season: light, broad-based work focused on mobility, movement quality, and unstructured play.'
    : '';

  const sportLoadInstruction = (intake.clubTrainingsPerWeek || intake.matchesPerWeek)
    ? '\nHARD LOAD-MANAGEMENT RULE: factor the player\'s existing weekly sport load into every week of the plan. Total weekly sessions = club trainings + matches + plan sessions. Total recoverable load per week for most athletes is 5-6 sessions (less if matches are present). If the player already has 2 club trainings + 1 match per week, that is 3 sport-specific sessions; the plan should add no more than 2-3 sessions on top, and at least one of those should be a light/recovery session. Schedule lighter or mobility-focused sessions day-after-match. If the player has 0 matches and pre-season phase, the plan can carry more volume. NEVER prescribe a heavy lift the day before a match or the day after one. Coach Notes for each week should reference how the plan sits alongside the player\'s stated sport load (e.g. "Heavy strength session is Tue, the day after your Mon training and before your Thu training, leaving Fri light into Sat match").'
    : '';

  const companionInstruction = intake.companionPlanSummary
    ? '\nThe client is also doing a Mind the Gael Mental Performance Plan. Where it fits naturally, write session cues and weekly notes that reinforce the mental work they shared. For example: tie session-level focus cues to refocus routines they are practising; in Coach Notes, suggest moments in the training week where they can layer in pre-performance routines or self-talk practice. Stay within what they actually described, never invent specifics from the mental plan.'
    : '';

  return [
    `Create a ${intake.planDuration || '6-week'} progression plan for the following female athlete client. This plan will be emailed directly to them.`,
    '',
    sportProfileBlock,
    '',
    exercisePoolBlock,
    '',
    trackBlock,
    '',
    avoidBlock,
    '',
    clientBlock,
    seasonPhaseInstruction,
    sportLoadInstruction,
    companionInstruction,
    '',
    'Follow the system prompt rules strictly. Use the exact output section headers it specifies.',
  ].join('\n');
}

// ─── Emails ────────────────────────────────────────────────────────

async function sendClientPlanEmail(input: {
  intake: ConsultationWithPlanRequest;
  fullPlan: string;
  sportProfile: SportProfile;
}): Promise<void> {
  const resendApiKey = import.meta.env.RESEND_API_KEY;
  const fromEmail =
    import.meta.env.CONSULTATION_FROM_EMAIL || 'Mind the Gael <onboarding@resend.dev>';
  if (!resendApiKey) throw new Error('Missing RESEND_API_KEY.');

  const { intake, fullPlan, sportProfile } = input;
  const firstName = (intake.name || '').split(' ')[0] || 'there';
  const duration = intake.planDuration || '6-week';

  // Plain text fallback for email clients that don't render HTML.
  const text = [
    `Hi ${firstName},`,
    '',
    `Thanks for buying the ${duration} programme. Below is your full plan, built around your sport (${sportProfile.name}), your equipment, and your goals.`,
    '',
    'A few important notes before you start:',
    '- This plan is educational guidance, not clinical or medical advice.',
    '- If anything in the plan feels off, painful, or unclear, stop and email me at ' + EMILY_EMAIL + '.',
    '- If you experience new pain, symptoms, or a change in how your body is responding, contact your doctor or physio.',
    '',
    '------------------------------------------',
    '',
    fullPlan,
    '',
    '------------------------------------------',
    '',
    'Once you\'ve had a read through, if you want to talk it through, book a 1:1 chat with me here: ' + EMILY_CALENDAR_BOOKING_URL,
    '',
    'You can also reach me any time at ' + EMILY_EMAIL + '. I want to know how you get on.',
    '',
    buildSignatureText(),
  ].join('\n');

  // Styled HTML version. Modern email clients render this; older ones fall
  // back to the plain text above (Resend handles multipart automatically).
  const html = buildClientPlanEmailHtml({
    firstName,
    duration,
    sportProfileName: sportProfile.name,
    planText: fullPlan,
    calendarUrl: EMILY_CALENDAR_BOOKING_URL,
    emilyEmail: EMILY_EMAIL,
  });

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [intake.email],
      subject: `Your ${duration} plan from Mind the Gael`,
      text,
      html,
      reply_to: EMILY_EMAIL,
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => 'No response body');
    throw new Error(`Failed to send client plan email: ${response.status} ${details}`);
  }
}

async function sendEmilyNotification(input: {
  intake: ConsultationWithPlanRequest;
  fullPlan: string;
  sportProfile: SportProfile;
  track: ProgramTrackId;
  sessionId: string;
  token: string;
  planType: 'physical' | 'mental';
  reviewRequired: boolean;
}): Promise<void> {
  const resendApiKey = import.meta.env.RESEND_API_KEY;
  const fromEmail =
    import.meta.env.CONSULTATION_FROM_EMAIL || 'Mind the Gael <onboarding@resend.dev>';
  if (!resendApiKey) return;

  const { intake, fullPlan, sportProfile, track, sessionId, token, planType, reviewRequired } = input;

  const planLabel = planType === 'mental' ? 'Mental Performance Plan' : 'Training Plan';

  const subject = reviewRequired
    ? `[REVIEW REQUIRED] ${planLabel} for ${intake.name} | ${intake.planDuration || 'plan'}`
    : `[Plan sent to client] ${planLabel} for ${intake.name} | ${intake.planDuration || 'plan'}`;

  const headlineLine = reviewRequired
    ? 'A new plan has been generated. The client has NOT received it. Review the plan below, edit if needed, then forward to the client manually.'
    : 'A new plan has been generated AND sent to the client. This is your notification copy.';

  // Plain text fallback.
  const text = [
    headlineLine,
    '',
    `Submitted: ${new Date().toISOString()}`,
    `Plan type: ${planLabel}`,
    `Name: ${intake.name}`,
    `Email: ${intake.email}`,
    `Phone: ${intake.phone || 'Not provided'}`,
    `Sport: ${intake.sport} (matched profile: ${sportProfile.name})`,
    `Track: ${track}`,
    `Plan duration: ${intake.planDuration || 'Not provided'}`,
    `Stripe session: ${sessionId}`,
    `Intake token: ${token}`,
    '',
    reviewRequired ? 'PLAN (NOT YET SENT TO CLIENT — REVIEW AND FORWARD)' : 'PLAN SENT TO CLIENT',
    '------------------------------------------',
    fullPlan,
  ].join('\n');

  // Styled HTML version.
  const html = buildEmilyNotificationEmailHtml({
    clientName: intake.name,
    clientEmail: intake.email,
    clientPhone: intake.phone,
    sport: intake.sport,
    sportProfileName: sportProfile.name,
    track,
    planDuration: intake.planDuration || 'Not provided',
    stripeSessionId: sessionId,
    intakeToken: token,
    planText: fullPlan,
  });

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [EMILY_EMAIL],
      subject,
      text,
      html,
      reply_to: intake.email,
    }),
  });
}

// Send the customer a short "we received your purchase, plan is under review"
// confirmation when the plan routes to Emily for review (v1 default).
async function sendClientHoldingEmail(input: {
  intake: ConsultationWithPlanRequest;
  planType: 'physical' | 'mental';
}): Promise<void> {
  const resendApiKey = import.meta.env.RESEND_API_KEY;
  const fromEmail =
    import.meta.env.CONSULTATION_FROM_EMAIL || 'Mind the Gael <onboarding@resend.dev>';
  if (!resendApiKey) throw new Error('Missing RESEND_API_KEY.');

  const { intake, planType } = input;
  const firstName = (intake.name || '').split(' ')[0] || 'there';
  const duration = intake.planDuration || '6-week';
  const planLabel = planType === 'mental' ? 'mental performance plan' : 'training plan';

  const text = [
    `Hi ${firstName},`,
    '',
    `Thanks for buying the ${duration} ${planLabel}. Your payment has landed.`,
    '',
    'Your plan has been drafted and is now with Emily for a quick review. You will receive the full plan by email within 48 hours.',
    '',
    'Why a review: while the platform is in its early phase, every plan gets a final read-through from Emily before it lands in your inbox. This is to make sure the plan reflects what you shared and meets the standard you paid for.',
    '',
    'If anything is urgent in the meantime, you can email Emily directly at ' + EMILY_EMAIL + '.',
    '',
    buildSignatureText(),
  ].join('\n');

  const html = `
    <div style="font-family: Georgia, 'Times New Roman', serif; line-height: 1.6; color: #1a2e1f; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; margin-bottom: 20px;">
        <img src="https://mindthegael.co.uk/assets/MTG_colour.png" alt="Mind the Gael" style="max-width: 180px; height: auto;" />
      </div>
      <p>Hi ${firstName},</p>
      <p>Thanks for buying the <strong>${duration} ${planLabel}</strong>. Your payment has landed.</p>
      <p>Your plan has been drafted and is now with Emily for a quick review. You will receive the full plan by email <strong>within 48 hours</strong>.</p>
      <div style="background: #f4ffe8; border-left: 4px solid #c0fe71; padding: 14px 18px; margin: 20px 0; border-radius: 6px;">
        <strong>Why the review:</strong> while the platform is in its early phase, every plan gets a final read-through from Emily before it lands in your inbox. This is to make sure the plan reflects what you shared and meets the standard you paid for.
      </div>
      <p>If anything is urgent in the meantime, you can email Emily directly at <a href="mailto:${EMILY_EMAIL}" style="color: #69005a;">${EMILY_EMAIL}</a>.</p>
      <p style="margin-top: 30px; color: #69005a; font-style: italic;">
        Emily Phelan<br/>
        Mind the Gael<br/>
        <a href="https://mindthegael.co.uk" style="color: #69005a;">mindthegael.co.uk</a>
      </p>
    </div>
  `;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [intake.email],
      subject: `Your ${duration} ${planLabel} is being reviewed`,
      text,
      html,
      reply_to: EMILY_EMAIL,
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => 'No response body');
    throw new Error(`Failed to send client holding email: ${response.status} ${details}`);
  }
}

function readStandardDestination(): 'emily' | 'client' {
  const raw = (import.meta.env.PLAN_DESTINATION_STANDARD as string | undefined) || 'emily';
  return raw === 'client' ? 'client' : 'emily';
}

// ─── Helpers ───────────────────────────────────────────────────────

function json(payload: any, status: number = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function getErrorMessage(error: any): string {
  if (error?.message?.includes('ANTHROPIC_API_KEY')) {
    return 'AI service is not configured yet.';
  }
  if (error?.message?.includes('STRIPE_SECRET_KEY')) {
    return 'Stripe is not configured yet.';
  }
  if (error?.message?.includes('RESEND_API_KEY')) {
    return 'Email service is not configured yet.';
  }
  if (error?.message?.toLowerCase?.().includes('rate limit')) {
    return 'AI rate limit reached. Please try again shortly.';
  }
  return 'We could not finalize your plan right now. Please contact Emily directly at emilyphelan@mindthegael.co.uk.';
}
