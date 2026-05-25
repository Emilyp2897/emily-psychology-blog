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
import { buildClientPlanEmailHtml, buildEmilyNotificationEmailHtml } from '../../lib/email-format';

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

    // 1. Fetch the intake session from the database.
    const intakeResult = await sql<{
      intake_data: ConsultationWithPlanRequest;
      programme_track: ProgramTrackId | null;
      finalized_at: string | null;
      red_flag_id: string | null;
    }>`
      SELECT intake_data, programme_track, finalized_at, red_flag_id
      FROM intake_sessions
      WHERE id = ${token}::uuid
      LIMIT 1
    `;

    const row = intakeResult.rows[0];
    if (!row) {
      return json({ error: 'Intake session not found.' }, 404);
    }
    if (row.red_flag_id) {
      return json({ error: 'This intake was flagged for direct review by Emily. Plan generation is blocked.' }, 403);
    }
    if (row.finalized_at) {
      return json({ error: 'This plan has already been generated and emailed.' }, 409);
    }

    // 2. Verify the Stripe session is paid.
    const stripeSecretKey = import.meta.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      throw new Error('Missing STRIPE_SECRET_KEY.');
    }
    const stripe = new Stripe(stripeSecretKey);
    const stripeSession = await stripe.checkout.sessions.retrieve(sessionId);

    if (stripeSession.payment_status !== 'paid') {
      return json(
        {
          error: `Stripe session payment status is "${stripeSession.payment_status}". Plan will only be generated once payment is confirmed.`,
        },
        402
      );
    }

    // 3. Generate the FULL plan.
    const intake = row.intake_data;
    const track = (row.programme_track || 'standard') as ProgramTrackId;

    const sportProfile = findSportProfile(intake.sport || '');
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

    const fullPlan = await generateFullPlan({
      intake,
      track,
      sportProfile,
      exercisePool,
      avoidIfTags,
    });

    // 4. Email the client.
    await sendClientPlanEmail({ intake, fullPlan, sportProfile });

    // 5. Email Emily a notification copy.
    await sendEmilyNotification({ intake, fullPlan, sportProfile, track, sessionId, token });

    // 6. Mark intake session finalized.
    await sql`
      UPDATE intake_sessions
      SET finalized_at = NOW(), stripe_session_id = ${sessionId}
      WHERE id = ${token}::uuid
    `;

    return json({
      success: true,
      message: 'Your plan has been generated and emailed to you. Check your inbox.',
    });
  } catch (error: any) {
    console.error('Programme finalize error:', error);
    return json({ error: getErrorMessage(error) }, 500);
  }
};

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

  const response = await client.messages.create({
    model,
    temperature: 0.5,
    max_tokens: input.track === 'standard' ? 2400 : 2800,
    system: buildSystemPrompt(),
    messages: [{ role: 'user', content: buildPlanPrompt(input) }],
  });

  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
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
    '(For each week:',
    '  ## Week N: [theme]',
    '  Focus:',
    '  Sessions:',
    '    Session 1 (day type): exercises with sets x reps at RPE, rest periods',
    '    Session 2 ...',
    '  Cues for the week:',
    '  Cycle consideration:',
    '  How to know you are ready to progress: )',
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
    `- Plan goals: ${(intake.planGoals || []).join(', ')}`,
    `- Issues/concerns: ${intake.issuesWorries || 'none provided'}`,
    `- Lifestyle: ${intake.lifestyle || 'not provided'}`,
    `- Medical conditions: ${intake.medicalConditions || 'none'}`,
    `- Injuries / limitations: ${intake.injuries || 'none'}`,
    `- Cycle status: ${intake.cycleStatus || 'not provided'}`,
    `- Current week looks like: ${intake.currentWeek || 'not provided'}`,
    `- Anything else: ${intake.anythingElse || 'not provided'}`,
    `- Specific goals narrative: ${intake.goals}`,
  ].join('\n');

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
    'Emily',
    'Mind the Gael',
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
}): Promise<void> {
  const resendApiKey = import.meta.env.RESEND_API_KEY;
  const fromEmail =
    import.meta.env.CONSULTATION_FROM_EMAIL || 'Mind the Gael <onboarding@resend.dev>';
  if (!resendApiKey) return;

  const { intake, fullPlan, sportProfile, track, sessionId, token } = input;

  // Plain text fallback.
  const text = [
    'A new programme purchase has been finalised and the plan has been emailed to the client.',
    '',
    `Submitted: ${new Date().toISOString()}`,
    `Name: ${intake.name}`,
    `Email: ${intake.email}`,
    `Phone: ${intake.phone || 'Not provided'}`,
    `Sport: ${intake.sport} (matched profile: ${sportProfile.name})`,
    `Track: ${track}`,
    `Plan duration: ${intake.planDuration || 'Not provided'}`,
    `Stripe session: ${sessionId}`,
    `Intake token: ${token}`,
    '',
    'PLAN SENT TO CLIENT',
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
      subject: `[Programme finalised] ${intake.name} | ${intake.planDuration || 'plan'}`,
      text,
      html,
      reply_to: intake.email,
    }),
  });
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
