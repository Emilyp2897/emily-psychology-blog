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
import { buildEmilyNotificationEmailHtml, stripDashes, buildSignatureText } from '../../lib/email-format';

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

function describeTrainingDays(days: unknown): string {
  if (!Array.isArray(days) || days.length === 0) return 'not provided';
  const labels: Record<string, string> = {
    mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
    fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
  };
  return days
    .filter((d): d is string => typeof d === 'string')
    .map(d => labels[d.toLowerCase()] || d)
    .join(', ');
}

function describeActiveTrainingStatus(status: string | undefined | null): string {
  switch (status) {
    case 'actively_competing':
      return 'Currently training AND competing regularly. Plan at a level that complements an athlete already at full sport load; do NOT default to beginner work.';
    case 'training_not_competing':
      return 'Training in their sport but not yet competing. Plan can push moderate-to-high intensity, no competition recovery constraints.';
    case 'building_back_up':
      return 'Building back up after a break or injury. Start lighter, progress conservatively, watch for re-aggravation, no early high-intensity blocks.';
    case 'not_training':
      return 'Not currently training with their sport. Plan can be foundational; the gym/mental work is their main load right now.';
    default:
      return 'not provided. Ask Emily before assuming intensity level.';
  }
}

export const prerender = false;

const EMILY_EMAIL = 'emilyphelan@mindthegael.co.uk';

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

 // 3b. Save the full plan to Supabase.
try {
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(
    import.meta.env.PUBLIC_SUPABASE_URL,
    import.meta.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data: userData } = await supabase.auth.admin.listUsers();
  const matchedUser = userData?.users?.find((u: { email?: string }) => u.email === intake.email);
  const weeks_total = (intake.planDuration || '').includes('12') ? 12 : 6;

  if (matchedUser) {
    const { error } = await supabase.from('Plans').insert({
      user_id: matchedUser.id,
      plan_type: planType,
      plan_content: fullPlan,
      status: 'pending_review',
      weeks_total,
      created_at: new Date().toISOString(),
    });
    if (error) {
      console.error('Supabase insert error:', error);
    }
  } else {
    console.warn(`Supabase: no user found for email ${intake.email}. Plan not saved to account.`);
  }
} catch (err) {
  console.error('Failed to save plan to Supabase:', err);
}

 // 4. Email Emily a short notification (not the full plan - she reviews in dashboard).
await sendEmilyNotification({
  intake,
  fullPlan,
  sportProfile,
  track,
  sessionId,
  token,
  planType,
  reviewRequired: true,
});

// 5. Email the client a holding message.
await sendClientHoldingEmail({ intake, planType });

// 6. Mark intake session finalized.
await sql`
  UPDATE intake_sessions
  SET finalized_at = NOW(), stripe_session_id = ${sessionId}
  WHERE id = ${token}::uuid
`;

  return {
    ok: true,
    sentFullPlanToClient: false,
    message: 'Thanks for your purchase. Your plan is being reviewed and will be available in your dashboard within 48 hours.',
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

  // Sizing: each week with two sessions (table + exercise descriptions +
  // cues + cycle note + progression note) lands around 900-1400 tokens.
  // Plus snapshot + overview + coach notes per week + things-to-track +
  // contraindicated section. Previous caps (6000 / 12000) were right at
  // the edge and the model was hitting max_tokens before finishing.
  // New caps give roughly 25-40% headroom.
  const is12Week = (input.intake.planDuration || '').includes('12');
  // Bumped to fit the explicit OUTPUT STRUCTURE: per-session warm-up
  // additions + main session table + blockquote descriptions + the
  // Plan Overview's standard warm-up table push token cost up.
  const baseTokens = is12Week ? 24000 : 14000;
  const trackBonus = input.track !== 'standard' ? 2000 : 0;
  const maxTokens = baseTokens + trackBonus;

  const response = await client.messages.create({
    model,
    temperature: 0.5,
    max_tokens: maxTokens,
    system: [
      { type: 'text', text: buildSystemPrompt(), cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: buildPlanPrompt(input) }],
  });

  // Flag the truncation case so it shows up in logs instead of silently
  // landing in the customer's inbox missing the final weeks.
  if (response.stop_reason === 'max_tokens') {
    console.warn(
      `[programme-finalize] physical plan hit max_tokens (cap=${maxTokens}, duration=${input.intake.planDuration}, track=${input.track}). Output truncated.`,
    );
  }

  const raw = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

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

  // Mental plans: each week is concept explainer + daily practice table +
  // performance moment + reflection prompt. Plus athlete snapshot + plan
  // overview + routines-to-build + coach notes + things-to-track.
  // Same headroom bump as the physical generator.
  const is12Week = (input.intake.planDuration || '').includes('12');
  const maxTokens = is12Week ? 20000 : 12000;

  const response = await client.messages.create({
    model,
    temperature: 0.5,
    max_tokens: maxTokens,
    system: [
      { type: 'text', text: buildMentalSystemPrompt(), cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: buildMentalPlanPrompt(input) }],
  });

  if (response.stop_reason === 'max_tokens') {
    console.warn(
      `[programme-finalize] mental plan hit max_tokens (cap=${maxTokens}, duration=${input.intake.planDuration}). Output truncated.`,
    );
  }

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
    'OUTPUT STRUCTURE. You MUST use these exact section headers, in this exact order. You MUST fill every required subsection. Do NOT skip, rename, merge, reorder, or improvise. Each bolded subsection label below must appear verbatim.',
    '',
    '# HOW TO READ THIS PLAN',
    'A short friendly orientation block. Cover, in this exact order, each item bolded:',
    '  - **Weekly structure:** "Each week opens with a concept, then a daily practice table, then a moment to apply it, then a reflection prompt."',
    '  - **Daily practice:** "5-10 minutes per day. Tick each row off on your dashboard as you go."',
    '  - **Reflection prompt:** "One question at the end of each week. Write the answer in a notebook, your phone, or a journal app — what matters is that you write it."',
    '  - **Routines to build:** "By the end of the plan you will have a pre-performance routine, a refocus routine, and a reset cue. Re-read these in match weeks."',
    '  - **Maith thú celebrations:** "When you tick off a day or finish a week, Saoirse will pop in to celebrate. Tick consistently and your dashboard tracks your streak."',
    'Keep this section warm, short, and in second person. Do NOT add anything beyond the items above.',
    '',
    '# ATHLETE SNAPSHOT',
    'Bolded fields, one per line, in this exact order. Fill each from the intake. Use "Not provided" if a field is missing.',
    '  **Name (first only or alias):**',
    '  **Sport:**',
    '  **Competition level:**',
    '  **Years competing:**',
    '  **Season phase:**',
    '  **Active training status:**',
    '  **Current weekly sport load:**',
    '  **Sport training days:**',
    '  **Plan duration:**',
    '  **Current confidence (1-10):**',
    '  **Performance moments they want to work on:**',
    '  **Companion physical plan:** (if a companion physical plan is being run; otherwise write "None at this time.")',
    '',
    'Then a paragraph headed **Key context:** that is 2-3 sentences summarising who they are and the headline mental performance areas the plan addresses.',
    '',
    '# PLAN OVERVIEW',
    'Required subsections, in this exact order, each headed with the bolded label below. Do NOT skip any.',
    '',
    '  **Structure:** one line — total weeks and what the customer practices daily vs weekly.',
    '',
    '  **Weekly themes:** a bulleted list, one bullet per week (Week 1, Week 2, ...). Each bullet names the theme drawn from the 12 toolkit themes where relevant, plus one line on what state that week moves them toward.',
    '',
    '  **Through-line:** one short paragraph naming what state you are helping the athlete move toward by the end of the plan.',
    '',
    '  **Programming priorities:** a numbered list 1-5 of what this plan emphasises (e.g. attention control, self-talk, pre-performance routine, refocus, post-mistake reset) and one short line each on why for this athlete.',
    '',
    '  **Evidence base:** one short paragraph naming the frameworks or sources you draw on (e.g. Attention Control Theory, Self-Determination Theory, PETTLEP imagery, Hatzigeorgiadis et al. 2011 on self-talk).',
    '',
    '  **Companion plan integration:** include this subsection ONLY if a companion physical plan is being run. One short paragraph on how the mental work supports the physical training themes.',
    '',
    '# WEEK-BY-WEEK PLAN',
    'For each week, in this EXACT format and order:',
    '',
    '  ## Week N: [theme name, drawn from the 12 toolkit themes where relevant]',
    '  **Focus:** one short line on what this week is doing for them.',
    '',
    '  **Concept of the week:** 3-5 lines explaining the concept in plain English. Name the framework or author where relevant.',
    '',
    '  **Daily practice (5-10 minutes):** a markdown table the customer can tick row by row.',
    '  | Day | Practice | What it builds |',
    '  | --- | --- | --- |',
    '  List 5-7 days. Use specific day names where the athlete has reported sport training days (so practice can be timed around them); otherwise use Mon-Sun.',
    '',
    '  **Performance moment to apply it:** one short paragraph naming where in their training or competition week they should consciously apply the concept.',
    '',
    '  **Reflection prompt:** one question they answer at the end of the week.',
    '',
    '# ROUTINES TO BUILD',
    'Required subsections, each with the bolded label below. By the end of the plan the athlete will have assembled these from the weekly work.',
    '  **Pre-performance routine:** 3-5 lines describing the 2-3 minute script the athlete runs before competition.',
    '  **Refocus routine:** 3-5 lines describing what they do mid-game when attention slips.',
    '  **Post-mistake reset cue:** 1-2 lines describing the cue (word, breath, action) they use after an error.',
    '',
    '# COACH NOTES (FOR THE CLIENT)',
    'For each week, in this exact format:',
    '  ## Week N',
    '  **Why this week comes here:** one sentence on its place in the arc.',
    '  **What to watch for in yourself:** one sentence on signals to monitor.',
    '  **Adjust if:** one sentence with a concrete fallback (e.g. "If you have a match this week, do the daily practice on the morning of the match, not the evening before").',
    '',
    '# THINGS TO TRACK',
    'A bulleted list of what to journal or notice during the plan. Cover at minimum:',
    '  - When you applied the weekly concept and what happened',
    '  - Confidence rating (1-10) at the end of each week',
    '  - One thing you did well in your sport that week',
    '  - One moment that tested the concept and how it went',
    '  - Any anxiety, fatigue, or mood patterns worth flagging to Emily',
    '',
    'VOICE:',
    '- Warm, direct, grounded. Plain English. Match Emily\'s voice: no hype, no motivational filler, no emojis.',
    '- Second person ("You will...", "Your goal this week...").',
    '- Avoid em-dashes and en-dashes (use periods, commas, or parentheses instead).',
    '- Concrete cues, not abstract directives.',
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
    `- Sport training days: ${describeTrainingDays((intake as any).trainingDays)}`,
    `- Active training status: ${describeActiveTrainingStatus((intake as any).activeTrainingStatus)}`,
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
    ? '\nShape the week-by-week progression to fit the season phase. Pre-season: front-load foundation routines and habit-setting. Championship lead-up: front-load composure under pressure and mistake reset. In-season: prioritise quick-reset tools and self-talk for fatigue. Off-season: deeper identity work and reflection.'
    : '';

  const sportLoadInstruction = (intake.clubTrainingsPerWeek || intake.matchesPerWeek)
    ? '\nAnchor weekly routines to moments the player actually has in her week. If matches > 0: prioritise pre-match routines, post-mistake reset for mid-game, post-match decompression. If matches = 0: anchor routines to training days and in-session focus.'
    : '';

  const companionInstruction = intake.companionPlanSummary
    ? '\nThe client is also doing a Mind the Gael Physical Training Plan. Where it fits, anchor "Performance moment to apply it" each week to a real session or moment from their training plan. Stay within what they actually described.'
    : '';

  return [
    `Create a ${intake.planDuration || '6-week'} mental performance plan for the following female athlete client. This plan will be emailed directly to them.`,
    '',
    clientBlock,
    seasonPhaseInstruction,
    sportLoadInstruction,
    companionInstruction,
    '',
    'Follow the system prompt rules strictly. Use the exact output section headers it specifies. Anchor every week\'s concept to the 12 themes of the Gael Performance Toolkit.',
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
    '5. Cycle awareness: assume a typical 28-day cycle unless the client states otherwise.',
    '6. Contraindications: read the injuries and medical fields carefully.',
    '',
    'BEGINNER ACCESSIBILITY RULE:',
    'If the client\'s experience level is "Beginner" or contains "less than 1 year", explain every S&C term in plain English the first time it appears.',
    '',
    'CITATION RULE:',
    'Any specific claim that is NOT obvious general programming knowledge must come from a real named source. Never invent citations.',
    '',
    'OUTPUT STRUCTURE. You MUST use these exact section headers, in this exact order. You MUST fill every required subsection. Do NOT skip, rename, merge, reorder, or improvise. Each bolded subsection label below must appear verbatim.',
    '',
    '# HOW TO READ THIS PLAN',
    'A short friendly orientation block. Cover, in this exact order, with each item on its own line and the label bolded:',
    '  - **RPE (Rate of Perceived Exertion):** "RPE is how hard a set felt out of 10. RPE 7 = you could do 3 more reps if you had to. RPE 9 = only 1 rep left in the tank. Use it to scale weight day to day."',
    '  - **Sets x Reps:** "Sets are the rounds, reps are the number of times you do the exercise per round. 4 x 6 means 4 rounds of 6 reps."',
    '  - **Rest:** "How long to wait between sets so your strength recovers. Heavy lifts get longer rest."',
    '  - **Warm-up:** "Every session uses the same standard warm-up listed in Plan Overview. Each session adds 1-2 focus movements specific to that day."',
    '  - **Cues:** "One key thing to think about while doing the lift. Saoirse will pop in with these on your plan page."',
    '  - **Cycle consideration:** "A line on how to adapt the session around your menstrual cycle if relevant."',
    '  - **How to know you are ready to progress:** "What signs tell you it is time to add weight or move on to a harder variation."',
    '  - **Maith thú celebrations:** "When you tick off a session on the dashboard, Saoirse will pop in to celebrate. Tick every exercise so the day is marked complete."',
    'Keep this section warm, short, and in second person. Do NOT add anything beyond the items above.',
    '',
    '# CLIENT SNAPSHOT',
    'Bolded fields, one per line, in this exact order. Fill each from the intake. Use "Not provided" if a field is missing.',
    '  **Age:**',
    '  **Height:**',
    '  **Weight:**',
    '  **Experience level:**',
    '  **Sport:**',
    '  **Season phase:**',
    '  **Active training status:**',
    '  **Current weekly sport load:**',
    '  **Sport training days:**',
    '  **S&C sessions available:**',
    '  **Equipment:**',
    '  **Plan duration:**',
    '  **Primary goals:**',
    '  **Medical notes:**',
    '  **Cycle status:**',
    '  **Mental performance work:** (if a companion mental plan is being run; otherwise write "None at this time.")',
    '',
    'Then a paragraph headed **Key context:** that is 2-3 sentences summarising who they are and how this plan is pitched (intensity level, why this approach, what to expect).',
    '',
    '# PLAN OVERVIEW',
    'Required subsections, in this exact order, each headed with the bolded label below. Do NOT skip any.',
    '',
    '  **Structure:** one line — total weeks x sessions per week = total sessions.',
    '',
    '  **Phases:** a bulleted list of the periodisation blocks across the weeks (e.g. Weeks 1-2 Accumulation, Weeks 3-4 Intensification, Week 5 Deload, Week 6 Taper). One line per block describing what that block does.',
    '',
    '  **Session split:** one short paragraph naming what Session 1 and Session 2 emphasise (e.g. Lower + Power vs Upper + Conditioning). State this is consistent across all weeks.',
    '',
    '  **Standard warm-up (used before every session, 10-12 minutes):** an actual markdown table the athlete can follow. Format:',
    '  | Exercise | Sets | Reps / Duration | Purpose |',
    '  | --- | --- | --- | --- |',
    '  List 5-7 movements: light cardio (2-3 min), 2-3 mobility drills (hip/ankle/thoracic), 1-2 glute activation, 1-2 sport-specific movement primers. Choose exercises that exist in the AVAILABLE EXERCISE POOL or are obvious bodyweight/mobility movements (e.g. world\'s greatest stretch, 90/90 hip rotations, glute bridge, banded monster walks).',
    '',
    '  **Scheduling guidance:** use the athlete\'s reported club training days and matches to give concrete day suggestions (e.g. "Place Session 1 on Tuesday, 48 hours after Monday club training. Place Session 2 on Thursday — never lift heavy the day before or after a match"). Be specific, do not use generic placeholders.',
    '',
    '  **Programming priorities:** a numbered list 1-5 of what this plan emphasises (e.g. posterior chain strength for ACL/hamstring protection, single-leg stability, repeat-sprint ability) and one short line each on why for this athlete\'s sport.',
    '',
    '  **Injury-prevention emphasis:** one short paragraph on what protective work is woven through the plan, with at least one cited source (e.g. Petersen et al. 2011 on Nordic hamstring curls; Myer et al. 2013 on ACL prevention).',
    '',
    '  **Conditioning rationale:** one short paragraph on why the conditioning approach fits the energy demands of the sport.',
    '',
    '  **Body composition / nutrition note:** include this subsection ONLY if the client\'s primary goals mention fat loss, muscle gain, or body composition. One short paragraph on calorie balance and protein targets.',
    '',
    '  **Mental performance integration:** include this subsection ONLY if a companion mental plan is being run. One short paragraph on how the gym work supports the mental plan themes.',
    '',
    '# WEEK-BY-WEEK PLAN',
    'For each week, in this EXACT format and order:',
    '',
    '  ## Week N: [theme]',
    '  **Focus:** one short line on what this week is doing for them.',
    '',
    '  ### Session 1: [day type, e.g. "Lower Emphasis + Power"]',
    '',
    '  **Warm-up:** one short line referencing the standard warm-up and naming 1-2 session-specific primers to add today (e.g. "Standard warm-up. Add: 2 sets of 3 box jumps at low height to prime power output.").',
    '',
    '  **Main session:** a markdown table.',
    '  | Exercise | Sets | Reps | RPE | Rest |',
    '  | --- | --- | --- | --- | --- |',
    '  4-6 main lifts/movements, selected from the AVAILABLE EXERCISE POOL. Do NOT include warm-up or mobility entries here — those belong in the warm-up line above.',
    '',
    '  Blockquote (`>`) descriptions immediately after the table, one per exercise. Each blockquote opens with the exercise name in **bold** then explains what it is, how to perform it, what it protects against, and why it is in this week.',
    '',
    '  **Cues:** one short line on form/intent for this session.',
    '  **Cycle consideration:** one short line on cycle-aware adjustment.',
    '  **How to know you are ready to progress:** one short line on the criteria for adding load or moving on next week.',
    '',
    '  ### Session 2: [day type, e.g. "Upper Emphasis + Conditioning"]',
    '  Same exact structure as Session 1: **Warm-up:** line, then **Main session:** table, then blockquote descriptions, then **Cues:**, **Cycle consideration:**, **How to know you are ready to progress:**.',
    '',
    '# COACH NOTES',
    'For each week, in this exact format:',
    '  ## Week N',
    '  **Why this week sits here:** one sentence on its place in the periodisation.',
    '  **What to watch for in yourself:** one sentence on physical or mental signals to monitor.',
    '  **Adjust if:** one sentence with a concrete fallback (e.g. "If your match is rescheduled to a Sunday, swap Session 2 to Wednesday").',
    '',
    '# CONTRAINDICATED EXERCISES AND SUBSTITUTES',
    'A bulleted list of common exercises this client should NOT do given their medical notes, injuries, cycle status, or season phase. For each, name the safer substitute and one sentence on why.',
    '',
    '# THINGS TO TRACK',
    'A bulleted list of metrics to log session by session. Cover at minimum:',
    '  - Bar weight on key compound lifts',
    '  - RPE actually felt vs RPE prescribed',
    '  - Sleep quality and energy on training mornings',
    '  - Cycle day and perceived energy',
    '  - 24/48 hour soreness',
    '  - Any body composition or performance marker tied to their primary goals',
    '',
    'VOICE: warm, direct, plain English. No emojis. No em-dashes or en-dashes. Second person ("you"). Avoid filler. Cite real sources where you make specific claims.',
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
    `SPORT PROFILE:`,
    `Sport: ${sportProfile.name}`,
    `Energy system: ${sportProfile.energy_system}`,
    `Primary demands: ${sportProfile.primary_demands.join(', ')}`,
    `Power emphasis: ${sportProfile.power_emphasis}`,
    `Contact load: ${sportProfile.contact_load}`,
    `Common injury hotspots: ${sportProfile.injury_hotspots.join(', ')}`,
    `Programming notes: ${sportProfile.programming_notes}`,
  ].join('\n');

  const exercisePoolBlock = [
    `AVAILABLE EXERCISE POOL (choose only from this list):`,
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
        'CITATIONS for this track:',
        ...trackCitations.map((c) => `- ${c}`),
      ].join('\n')
    : 'Track: standard (no specialised protocol applies).';

  const avoidBlock = avoidIfTags.length
    ? `DETECTED CONTRAINDICATION TAGS: ${avoidIfTags.join(', ')}`
    : 'No specific contraindication tags detected.';

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
    `- Sport training days: ${describeTrainingDays((intake as any).trainingDays)}`,
    `- Active training status: ${describeActiveTrainingStatus((intake as any).activeTrainingStatus)}`,
    `- Plan goals: ${(intake.planGoals || []).join(', ')}`,
    `- Issues/concerns: ${intake.issuesWorries || 'none provided'}`,
    `- Lifestyle: ${intake.lifestyle || 'not provided'}`,
    `- Medical conditions: ${intake.medicalConditions || 'none'}`,
    `- Injuries / limitations: ${intake.injuries || 'none'}`,
    `- Cycle status: ${intake.cycleStatus || 'not provided'}`,
    `- Current week looks like: ${intake.currentWeek || 'not provided'}`,
    `- Companion mental performance plan: ${intake.companionPlanSummary || 'not provided. Build this plan as a standalone.'}`,
    `- Anything else: ${intake.anythingElse || 'not provided'}`,
    `- Specific goals narrative: ${intake.goals}`,
  ].join('\n');

  const seasonPhaseInstruction = intake.seasonPhase
    ? '\nShape the programme structure to match the season phase. Pre-season: accumulation block. Championship lead-up: intensification then taper. In-season: maintenance. Off-season: light broad-based work.'
    : '';

  const sportLoadInstruction = (intake.clubTrainingsPerWeek || intake.matchesPerWeek)
    ? '\nHARD LOAD-MANAGEMENT RULE: factor the player\'s existing weekly sport load into every week. Total recoverable load per week for most athletes is 5-6 sessions. Never prescribe a heavy lift the day before or after a match.'
    : '';

  const companionInstruction = intake.companionPlanSummary
    ? '\nThe client is also doing a Mind the Gael Mental Performance Plan. Where it fits naturally, write session cues and weekly notes that reinforce the mental work they shared.'
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
    reviewRequired ? 'PLAN (NOT YET SENT TO CLIENT - REVIEW AND FORWARD)' : 'PLAN SENT TO CLIENT',
    '------------------------------------------',
    fullPlan,
  ].join('\n');

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
    'Why a review: while the platform is in its early phase, every plan gets a final read-through from Emily before it lands in your inbox.',
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
        <strong>Why the review:</strong> while the platform is in its early phase, every plan gets a final read-through from Emily before it lands in your inbox.
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